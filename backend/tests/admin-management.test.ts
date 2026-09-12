import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The admin's write endpoints.
 *
 * Two things matter here and neither is the happy path: who is allowed to do
 * what, and whether an order can be moved somewhere the state machine forbids.
 */

const prismaMock = vi.hoisted(() => {
  const mock: Record<string, unknown> = {
    user: { findUnique: vi.fn() },
    order: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
    },
    orderEvent: { create: vi.fn() },
    paymentTransaction: { create: vi.fn() },
    productVariant: { update: vi.fn() },
    inventoryLedger: { create: vi.fn() },
    review: {
      findUnique: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    product: { update: vi.fn() },
    returnRequest: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    auditLog: { create: vi.fn() },
    job: { create: vi.fn(), findFirst: vi.fn() },
  };
  // The services run their work inside a transaction; the callback gets the
  // same mock, so assertions do not care which client was used.
  mock.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mock));
  return mock;
});

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));
vi.mock('../src/services/jobs', () => ({ enqueue: vi.fn() }));

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

const deliveredOrder = {
  id: 'order_1',
  orderNumber: 'MS-2026-000001',
  status: 'DELIVERED',
  phone: '+923001234567',
  grandTotal: 500_000,
  refundedTotal: 0,
  currency: 'PKR',
  paymentMethod: 'COD',
  items: [{ variantId: 'variant_1', quantity: 2 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
});

describe('who may do what', () => {
  it('keeps customers out of the order queue entirely', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('CUSTOMER'));

    const response = await request(app)
      .get('/api/admin/orders')
      .set('Cookie', await cookieFor('CUSTOMER'));

    expect(response.status).toBe(403);
  });

  it('lets staff read orders', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.order.count.mockResolvedValue(0);
    prismaMock.order.groupBy.mockResolvedValue([{ status: 'PENDING', _count: { _all: 3 } }]);

    const response = await request(app)
      .get('/api/admin/orders')
      .set('Cookie', await cookieFor('STAFF'));

    expect(response.status).toBe(200);
    expect(response.body.countsByStatus).toEqual({ PENDING: 3 });
  });

  it('refuses a refund to staff, who may fulfil but not move money', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));

    const response = await request(app)
      .post('/api/admin/orders/order_1/refund')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send({ amount: 1000, reason: 'Damaged in transit' });

    expect(response.status).toBe(403);
    expect(prismaMock.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('refuses a cancellation to staff, which would release stock', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));

    const response = await request(app)
      .patch('/api/admin/orders/order_1/status')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'CANCELLED', notifyCustomer: false });

    expect(response.status).toBe(403);
  });

  it('grants a single extra permission without promoting the whole role', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF', ['order.refund']));
    prismaMock.order.findUnique.mockResolvedValue(deliveredOrder);

    const response = await request(app)
      .post('/api/admin/orders/order_1/refund')
      .set('Cookie', await cookieFor('STAFF', ['order.refund']))
      .set('Origin', 'http://localhost:3000')
      .send({ amount: 100_000, reason: 'Sleeve length wrong on one piece' });

    expect(response.status).toBe(200);
  });
});

describe('the order state machine', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
  });

  it('refuses a move the state machine does not allow', async () => {
    prismaMock.order.findUnique.mockResolvedValue(deliveredOrder);

    const response = await request(app)
      .patch('/api/admin/orders/order_1/status')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'IN_PRODUCTION', notifyCustomer: false });

    expect(response.status).toBe(409);
    // Says what is possible instead of only what is not.
    expect(response.body.error).toContain('Refunded');
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('records the shipment and stamps the time', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...deliveredOrder, status: 'READY_TO_SHIP' });

    const response = await request(app)
      .patch('/api/admin/orders/order_1/status')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({
        status: 'SHIPPED',
        courier: 'TCS',
        trackingNumber: 'TCS123',
        notifyCustomer: true,
      });

    expect(response.status).toBe(200);
    const { data } = prismaMock.order.update.mock.calls[0][0];
    expect(data).toMatchObject({ status: 'SHIPPED', courier: 'TCS', trackingNumber: 'TCS123' });
    expect(data.shippedAt).toBeInstanceOf(Date);
    expect(prismaMock.orderEvent.create).toHaveBeenCalled();
  });

  it('puts stock back when an order is cancelled, with a ledger row explaining it', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...deliveredOrder, status: 'PENDING' });

    const response = await request(app)
      .patch('/api/admin/orders/order_1/status')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'CANCELLED', note: 'Customer changed their mind', notifyCustomer: false });

    expect(response.status).toBe(200);
    expect(prismaMock.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'variant_1' },
      data: { stockOnHand: { increment: 2 } },
    });
    expect(prismaMock.inventoryLedger.create.mock.calls[0][0].data).toMatchObject({
      delta: 2,
      reason: 'ORDER_CANCELLED',
      reference: 'MS-2026-000001',
    });
  });
});

describe('refunds', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
  });

  it('refuses more than the order has left', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...deliveredOrder, refundedTotal: 450_000 });

    const response = await request(app)
      .post('/api/admin/orders/order_1/refund')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ amount: 100_000, reason: 'Too much' });

    expect(response.status).toBe(422);
    expect(prismaMock.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('marks a part refund as partial, and a full one as refunded', async () => {
    prismaMock.order.findUnique.mockResolvedValue(deliveredOrder);

    const partial = await request(app)
      .post('/api/admin/orders/order_1/refund')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ amount: 200_000, reason: 'One piece returned' });

    expect(partial.body).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED' });

    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaMock),
    );
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.order.findUnique.mockResolvedValue(deliveredOrder);

    const full = await request(app)
      .post('/api/admin/orders/order_1/refund')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ amount: 500_000, reason: 'Whole order returned', restock: true });

    expect(full.body).toMatchObject({ paymentStatus: 'REFUNDED' });
    // Delivered → Refunded is a legal move, so the order follows its money.
    expect(prismaMock.order.update.mock.calls[0][0].data.status).toBe('REFUNDED');
    expect(prismaMock.inventoryLedger.create).toHaveBeenCalled();
  });
});

describe('review moderation', () => {
  it('recomputes the product rating when a review is published', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review_1',
      status: 'PENDING',
      productId: 'product_1',
      rating: 5,
    });
    prismaMock.review.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: { _all: 4 } });

    const response = await request(app)
      .patch('/api/admin/reviews/review_1')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'APPROVED' });

    expect(response.status).toBe(200);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'product_1' },
      data: { ratingAverage: 4.5, ratingCount: 4 },
    });
  });

  it('does not re-decide a review that already has that status', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review_1',
      status: 'APPROVED',
      productId: 'product_1',
      rating: 5,
    });

    const response = await request(app)
      .patch('/api/admin/reviews/review_1')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'APPROVED' });

    expect(response.status).toBe(409);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });
});
