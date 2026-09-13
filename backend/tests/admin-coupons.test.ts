import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Discount codes.
 *
 * What would cost money if it were wrong: staff creating discounts, a used
 * code's terms being changed under the orders that took it, and a used code
 * being deleted so those orders can no longer explain their totals.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  coupon: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}));

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

const terms = {
  code: 'eid10',
  type: 'PERCENTAGE',
  value: 10,
  maxDiscount: 50_000,
  minOrderSubtotal: 0,
  usageLimit: null,
  usageLimitPerUser: 1,
  appliesToCategoryIds: [],
  appliesToProductIds: [],
  firstOrderOnly: false,
  isActive: true,
  startsAt: null,
  endsAt: null,
};

const stored = {
  id: 'coupon_1',
  ...terms,
  code: 'EID10',
  description: null,
  usedCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
});

describe('who may manage coupons', () => {
  it('lets staff check a code but not create one', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.coupon.findMany.mockResolvedValue([{ ...stored, _count: { orders: 2 } }]);
    prismaMock.coupon.count.mockResolvedValue(1);

    const read = await request(app)
      .get('/api/admin/coupons')
      .set('Cookie', await cookieFor('STAFF'));
    expect(read.status).toBe(200);
    expect(read.body.items[0]).toMatchObject({ code: 'EID10', orderCount: 2 });

    const write = await request(app)
      .post('/api/admin/coupons')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', ORIGIN)
      .send(terms);

    expect(write.status).toBe(403);
    expect(prismaMock.coupon.create).not.toHaveBeenCalled();
  });
});

describe('creating a code', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
  });

  it('stores the code in capitals, as shoppers will type it any way they like', async () => {
    prismaMock.coupon.create.mockResolvedValue(stored);

    const response = await request(app)
      .post('/api/admin/coupons')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send(terms);

    expect(response.status).toBe(201);
    expect(prismaMock.coupon.create.mock.calls[0][0].data.code).toBe('EID10');
  });

  it('refuses a percentage over 100', async () => {
    const response = await request(app)
      .post('/api/admin/coupons')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ ...terms, value: 150 });

    expect(response.status).toBe(422);
    expect(prismaMock.coupon.create).not.toHaveBeenCalled();
  });

  it('explains a code that already exists', async () => {
    prismaMock.coupon.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['code'] },
      }),
    );

    const response = await request(app)
      .post('/api/admin/coupons')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send(terms);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('already exists');
  });
});

describe('a code that has been used', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.coupon.findUnique.mockResolvedValue({ ...stored, usedCount: 3 });
  });

  it('keeps its discount locked', async () => {
    const response = await request(app)
      .patch('/api/admin/coupons/coupon_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ ...terms, value: 25 });

    expect(response.status).toBe(422);
    expect(response.body.error).toContain('used 3 times');
    expect(prismaMock.coupon.update).not.toHaveBeenCalled();
  });

  it('can still be ended early, which only takes something away', async () => {
    prismaMock.coupon.update.mockResolvedValue({ ...stored, usedCount: 3 });

    const response = await request(app)
      .patch('/api/admin/coupons/coupon_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ ...terms, endsAt: '2026-12-31T23:59:59+05:00' });

    expect(response.status).toBe(200);
    expect(prismaMock.coupon.update).toHaveBeenCalled();
  });

  it('cannot be deleted, because orders explain their totals with it', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue({
      id: 'coupon_1',
      code: 'EID10',
      usedCount: 3,
      _count: { orders: 3 },
    });

    const response = await request(app)
      .delete('/api/admin/coupons/coupon_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN);

    expect(response.status).toBe(422);
    expect(prismaMock.coupon.delete).not.toHaveBeenCalled();
  });
});

describe('an unused code', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
  });

  it('can be deleted', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue({
      id: 'coupon_1',
      code: 'EID10',
      usedCount: 0,
      _count: { orders: 0 },
    });

    const response = await request(app)
      .delete('/api/admin/coupons/coupon_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN);

    expect(response.status).toBe(200);
    expect(prismaMock.coupon.delete).toHaveBeenCalledWith({ where: { id: 'coupon_1' } });
  });

  it('switches off with an audit entry saying so', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue({
      id: 'coupon_1',
      code: 'EID10',
      isActive: true,
    });
    prismaMock.coupon.update.mockResolvedValue({ id: 'coupon_1', code: 'EID10', isActive: false });

    const response = await request(app)
      .patch('/api/admin/coupons/coupon_1/active')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', ORIGIN)
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.summary).toBe('EID10 switched off');
  });
});
