import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productSchema } from '@momishop/shared/validation';

/**
 * The catalogue's write endpoints.
 *
 * What is worth testing here is the damage a wrong answer does: staff who may
 * count stock but not change a price, a stock correction that must leave a
 * paper trail, and the image references we actually ship.
 */

const prismaMock = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn() },
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productVariant: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    productImage: { deleteMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    inventoryLedger: { create: vi.fn() },
    category: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };

  mock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mock));
  return mock;
});

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { __setStoreForTesting } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });

function account(role: string, permissions: string[] = []) {
  return {
    id: `user_${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@momishop.pk`,
    name: role,
    image: null,
    role,
    status: 'ACTIVE',
    permissions,
    deletedAt: null,
  };
}

async function cookieFor(role: string, permissions: string[] = []): Promise<string> {
  const token = await signSessionToken({
    id: `user_${role.toLowerCase()}`,
    role: role as 'STAFF',
    status: 'ACTIVE',
    permissions,
  });
  return `momishop.session=${token}`;
}

const draft = {
  sku: 'MS-T-0001',
  slug: 'test-abaya',
  name: 'Test Abaya',
  categoryId: 'cat_1',
  basePrice: 750_000,
  variants: [],
  images: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
});

describe('who may change the catalogue', () => {
  it('lets staff look but not touch', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.product.findMany.mockResolvedValue([]);
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.product.groupBy.mockResolvedValue([]);

    const read = await request(app)
      .get('/api/admin/products')
      .set('Cookie', await cookieFor('STAFF'));
    expect(read.status).toBe(200);

    const write = await request(app)
      .post('/api/admin/products')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send(draft);

    expect(write.status).toBe(403);
    expect(prismaMock.product.create).not.toHaveBeenCalled();
  });

  it('lets an admin create one', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.product.create.mockResolvedValue({
      id: 'product_1',
      slug: draft.slug,
      name: draft.name,
    });

    const response = await request(app)
      .post('/api/admin/products')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send(draft);

    expect(response.status).toBe(201);
    expect(response.body.product.id).toBe('product_1');
    // A new piece is never live by accident.
    expect(prismaMock.product.create.mock.calls[0][0].data.status).toBe('DRAFT');
    expect(prismaMock.product.create.mock.calls[0][0].data.publishedAt).toBeNull();
  });

  it('explains a slug collision instead of leaking the constraint', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.product.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['slug'] },
      }),
    );

    const response = await request(app)
      .post('/api/admin/products')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send(draft);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('web address');
  });
});

describe('stock corrections', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.productVariant.findUnique.mockResolvedValue({
      id: 'variant_1',
      sku: 'MS-T-0001-BLK',
      stockOnHand: 10,
      productId: 'product_1',
    });
  });

  it('records the difference, not the new figure', async () => {
    const response = await request(app)
      .patch('/api/admin/variants/variant_1/stock')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send({ stockOnHand: 4, note: 'Recount after the sale' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stockOnHand: 4, delta: -6 });
    expect(prismaMock.inventoryLedger.create.mock.calls[0][0].data).toMatchObject({
      delta: -6,
      reason: 'ADJUSTMENT',
    });
  });

  it('writes no ledger row when the count was already right', async () => {
    const response = await request(app)
      .patch('/api/admin/variants/variant_1/stock')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send({ stockOnHand: 10 });

    expect(response.status).toBe(200);
    expect(prismaMock.inventoryLedger.create).not.toHaveBeenCalled();
  });
});

describe('what a product may look like', () => {
  it('accepts an image served from our own public folder', () => {
    const result = productSchema.safeParse({
      ...draft,
      images: [{ url: '/products/MS-A-0001-1.webp', alt: 'A black abaya' }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts a full https address', () => {
    const result = productSchema.safeParse({
      ...draft,
      images: [{ url: 'https://res.cloudinary.com/momishop/abaya.webp', alt: 'A black abaya' }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a protocol-relative or javascript URL', () => {
    for (const url of ['//evil.example/x.png', 'javascript:alert(1)']) {
      const result = productSchema.safeParse({ ...draft, images: [{ url, alt: 'Nope' }] });
      expect(result.success).toBe(false);
    }
  });

  it('insists on alt text, because a photo nobody can describe is a broken page', () => {
    const result = productSchema.safeParse({
      ...draft,
      images: [{ url: '/products/x.webp', alt: '' }],
    });

    expect(result.success).toBe(false);
  });
});
