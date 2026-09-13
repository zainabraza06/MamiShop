import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Managing storefront filters.
 *
 * The risks: staff reshaping the shop they may only look at, a built-in
 * filter deleted out from under the panel, a reorder that leaves two filters
 * in one position, and a product saved with a tag that no longer exists.
 */

const prismaMock = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn() },
    storefrontFilter: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    filterOption: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    productFilterValue: { groupBy: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    product: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    productVariant: { update: vi.fn(), create: vi.fn() },
    productImage: { deleteMany: vi.fn(), createMany: vi.fn() },
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
const ORIGIN = 'http://localhost:3000';

function account(role: string) {
  return {
    id: `user_${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@momishop.pk`,
    name: role,
    image: null,
    role,
    status: 'ACTIVE',
    permissions: [],
    deletedAt: null,
  };
}

async function cookieFor(role: string): Promise<string> {
  const token = await signSessionToken({
    id: `user_${role.toLowerCase()}`,
    role: role as 'STAFF',
    status: 'ACTIVE',
    permissions: [],
  });
  return `momishop.session=${token}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
});

describe('who may change filters', () => {
  it('lets staff see them but not create one', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.storefrontFilter.findMany.mockResolvedValue([]);
    prismaMock.productFilterValue.groupBy.mockResolvedValue([]);

    const read = await request(app)
      .get('/api/admin/filters')
      .set('Cookie', await cookieFor('STAFF'));
    expect(read.status).toBe(200);

    const write = await request(app)
      .post('/api/admin/filters')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', ORIGIN)
      .send({ label: 'Occasion', options: ['Eid'] });

    expect(write.status).toBe(403);
    expect(prismaMock.storefrontFilter.create).not.toHaveBeenCalled();
  });
});

describe('creating a filter', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.storefrontFilter.aggregate.mockResolvedValue({ _max: { position: 3 } });
  });

  it('adds a custom filter at the end, with URL-safe options and no duplicates', async () => {
    prismaMock.storefrontFilter.create.mockResolvedValue({ id: 'filter_1', label: 'Occasion' });

    const response = await request(app)
      .post('/api/admin/filters')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ label: 'Occasion', options: ['Eid', 'eid', 'Wedding Day'] });

    expect(response.status).toBe(201);
    const { data } = prismaMock.storefrontFilter.create.mock.calls[0][0];
    expect(data).toMatchObject({ kind: 'ATTRIBUTE', label: 'Occasion', slug: 'occasion' });
    expect(data.position).toBe(4);
    expect(data.options.create).toEqual([
      { label: 'Eid', slug: 'eid', position: 0 },
      { label: 'Wedding Day', slug: 'wedding-day', position: 1 },
    ]);
  });

  it('explains a name clash instead of failing on the constraint', async () => {
    prismaMock.storefrontFilter.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['slug'] },
      }),
    );

    const response = await request(app)
      .post('/api/admin/filters')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ label: 'Colour' });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('already a filter');
  });
});

describe('built-in and custom filters', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
  });

  it('refuses to delete a built-in filter, which can only be hidden', async () => {
    prismaMock.storefrontFilter.findUnique.mockResolvedValue({
      id: 'filter_color',
      kind: 'COLOR',
      label: 'Colour',
    });

    const response = await request(app)
      .delete('/api/admin/filters/filter_color')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('Hide it');
    expect(prismaMock.storefrontFilter.delete).not.toHaveBeenCalled();
  });

  it('deletes a custom filter', async () => {
    prismaMock.storefrontFilter.findUnique.mockResolvedValue({
      id: 'filter_1',
      kind: 'ATTRIBUTE',
      label: 'Occasion',
    });

    const response = await request(app)
      .delete('/api/admin/filters/filter_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN);

    expect(response.status).toBe(200);
    expect(prismaMock.storefrontFilter.delete).toHaveBeenCalledWith({ where: { id: 'filter_1' } });
  });

  it('hides a built-in filter', async () => {
    prismaMock.storefrontFilter.findUnique.mockResolvedValue({
      id: 'filter_fit',
      label: 'Fit',
      isVisible: true,
    });
    prismaMock.storefrontFilter.update.mockResolvedValue({
      id: 'filter_fit',
      label: 'Fit',
      isVisible: false,
    });

    const response = await request(app)
      .patch('/api/admin/filters/filter_fit')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ isVisible: false });

    expect(response.status).toBe(200);
    expect(prismaMock.storefrontFilter.update.mock.calls[0][0].data).toEqual({ isVisible: false });
  });

  it('will not add options to a built-in filter', async () => {
    prismaMock.storefrontFilter.findUnique.mockResolvedValue({
      id: 'filter_color',
      kind: 'COLOR',
      label: 'Colour',
      options: [],
    });

    const response = await request(app)
      .post('/api/admin/filters/filter_color/options')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ label: 'Teal' });

    expect(response.status).toBe(409);
    expect(prismaMock.filterOption.create).not.toHaveBeenCalled();
  });

  it('refuses an option the filter already has, whatever its case', async () => {
    prismaMock.storefrontFilter.findUnique.mockResolvedValue({
      id: 'filter_1',
      kind: 'ATTRIBUTE',
      label: 'Occasion',
      options: [{ label: 'Eid', slug: 'eid', position: 0 }],
    });

    const response = await request(app)
      .post('/api/admin/filters/filter_1/options')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ label: 'EID' });

    expect(response.status).toBe(409);
    expect(prismaMock.filterOption.create).not.toHaveBeenCalled();
  });
});

describe('ordering the panel', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.storefrontFilter.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('refuses a stale list that would leave two filters in one position', async () => {
    const response = await request(app)
      .put('/api/admin/filters/order')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ ids: ['a', 'b'] });

    expect(response.status).toBe(409);
    expect(prismaMock.storefrontFilter.update).not.toHaveBeenCalled();
  });

  it('writes positions top to bottom', async () => {
    const response = await request(app)
      .put('/api/admin/filters/order')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ ids: ['c', 'a', 'b'] });

    expect(response.status).toBe(200);
    expect(prismaMock.storefrontFilter.update.mock.calls.map(([args]) => args)).toEqual([
      { where: { id: 'c' }, data: { position: 0 } },
      { where: { id: 'a' }, data: { position: 1 } },
      { where: { id: 'b' }, data: { position: 2 } },
    ]);
  });
});

describe('tagging a product', () => {
  const payload = {
    sku: 'MS-A-0001',
    slug: 'noor-abaya',
    name: 'Noor Abaya',
    categoryId: 'cat_1',
    basePrice: 750_000,
  };

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.product.findUnique.mockResolvedValue({
      id: 'product_1',
      slug: 'noor-abaya',
      name: 'Noor Abaya',
      status: 'ACTIVE',
      basePrice: 750_000,
      publishedAt: new Date(),
    });
  });

  it('refuses an option that no longer exists, rather than failing on the foreign key', async () => {
    prismaMock.filterOption.count.mockResolvedValue(0);

    const response = await request(app)
      .patch('/api/admin/products/product_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ ...payload, filterOptionIds: ['option_gone'] });

    expect(response.status).toBe(422);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });

  it('replaces the product tags with the ones ticked', async () => {
    prismaMock.filterOption.count.mockResolvedValue(2);

    const response = await request(app)
      .patch('/api/admin/products/product_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ ...payload, filterOptionIds: ['option_eid', 'option_wedding', 'option_eid'] });

    expect(response.status).toBe(200);
    expect(prismaMock.productFilterValue.deleteMany).toHaveBeenCalledWith({
      where: { productId: 'product_1' },
    });
    expect(prismaMock.productFilterValue.createMany.mock.calls[0][0].data).toEqual([
      { productId: 'product_1', optionId: 'option_eid' },
      { productId: 'product_1', optionId: 'option_wedding' },
    ]);
    // Filter tags are not product columns.
    expect(prismaMock.product.update.mock.calls[0][0].data).not.toHaveProperty('filterOptionIds');
  });
});
