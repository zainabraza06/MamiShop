import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The customer screen.
 *
 * The things that would hurt if they were wrong: a password hash reaching a
 * staff member's browser, a suspension nobody can account for, and a points
 * balance that does not match its own ledger.
 */

const prismaMock = vi.hoisted(() => {
  const mock = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    order: { findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
    loyaltyAccount: { upsert: vi.fn() },
    loyaltyTransaction: { create: vi.fn() },
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

const customer = {
  id: 'customer_1',
  email: 'noor@example.com',
  status: 'ACTIVE',
  marketingOptIn: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
});

describe('the customer list', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.order.groupBy.mockResolvedValue([]);
  });

  it('never selects the password hash', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/admin/customers')
      .set('Cookie', await cookieFor('STAFF'));

    const { select } = prismaMock.user.findMany.mock.calls[0][0];
    expect(select.passwordHash).toBeUndefined();
    expect(select).not.toHaveProperty('permissions');
  });

  it('counts only banked orders toward lifetime spend', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        ...customer,
        name: 'Noor',
        phone: null,
        createdAt: new Date(),
        lastLoginAt: null,
        _count: { orders: 3 },
      },
    ]);
    prismaMock.order.groupBy.mockResolvedValue([
      { userId: 'customer_1', _sum: { grandTotal: 120_000 }, _max: { placedAt: new Date() } },
    ]);

    const response = await request(app)
      .get('/api/admin/customers')
      .set('Cookie', await cookieFor('STAFF'));

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ orderCount: 3, lifetimeSpend: 120_000 });

    // A cancelled or refunded order is not money the shop kept.
    const statuses = prismaMock.order.groupBy.mock.calls[0][0].where.status.in;
    expect(statuses).not.toContain('CANCELLED');
    expect(statuses).not.toContain('REFUNDED');
    expect(statuses).not.toContain('PENDING');
  });
});

describe('suspending an account', () => {
  it('is refused to staff, who may read customers but not lock them out', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));

    const response = await request(app)
      .patch('/api/admin/customers/customer_1')
      .set('Cookie', await cookieFor('STAFF'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'SUSPENDED', reason: 'Chargeback fraud' });

    expect(response.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('insists on a reason, so the audit log explains itself later', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.user.findFirst.mockResolvedValue(customer);

    const response = await request(app)
      .patch('/api/admin/customers/customer_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'SUSPENDED' });

    expect(response.status).toBe(422);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('records who did it and why', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.user.findFirst.mockResolvedValue(customer);
    prismaMock.user.update.mockResolvedValue({
      id: 'customer_1',
      status: 'SUSPENDED',
      marketingOptIn: true,
    });

    const response = await request(app)
      .patch('/api/admin/customers/customer_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'SUSPENDED', reason: 'Repeated chargebacks' });

    expect(response.status).toBe(200);
    const { data } = prismaMock.auditLog.create.mock.calls[0][0];
    expect(data.action).toBe('customer.suspend');
    expect(data.actorEmail).toBe('admin@momishop.pk');
    // The log stores a diff, not two full snapshots.
    expect(JSON.stringify(data.diff)).toContain('Repeated chargebacks');
    expect(data.summary).toContain('suspended');
  });

  it('reinstating needs no reason, because it takes nothing away', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.user.findFirst.mockResolvedValue({ ...customer, status: 'SUSPENDED' });
    prismaMock.user.update.mockResolvedValue({
      id: 'customer_1',
      status: 'ACTIVE',
      marketingOptIn: true,
    });

    const response = await request(app)
      .patch('/api/admin/customers/customer_1')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ status: 'ACTIVE' });

    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe('customer.reinstate');
  });
});

describe('points adjustments', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
  });

  it('refuses to take more points than the customer has', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      ...customer,
      loyaltyAccount: { id: 'loyalty_1', balance: 50 },
    });

    const response = await request(app)
      .post('/api/admin/customers/customer_1/loyalty')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ delta: -100, reason: 'Clawback' });

    expect(response.status).toBe(422);
    expect(prismaMock.loyaltyAccount.upsert).not.toHaveBeenCalled();
  });

  it('moves the balance and the ledger together', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      ...customer,
      loyaltyAccount: { id: 'loyalty_1', balance: 50 },
    });
    prismaMock.loyaltyAccount.upsert.mockResolvedValue({
      id: 'loyalty_1',
      balance: 250,
      lifetimeEarned: 250,
      lifetimeSpent: 0,
    });

    const response = await request(app)
      .post('/api/admin/customers/customer_1/loyalty')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ delta: 200, reason: 'Goodwill after a late delivery' });

    expect(response.status).toBe(200);
    expect(prismaMock.loyaltyAccount.upsert.mock.calls[0][0].update).toMatchObject({
      balance: { increment: 200 },
      lifetimeEarned: { increment: 200 },
    });
    expect(prismaMock.loyaltyTransaction.create.mock.calls[0][0].data).toMatchObject({
      delta: 200,
      reason: 'ADJUSTMENT',
    });
  });

  it('rejects a zero adjustment rather than writing a meaningless row', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      ...customer,
      loyaltyAccount: { id: 'loyalty_1', balance: 50 },
    });

    const response = await request(app)
      .post('/api/admin/customers/customer_1/loyalty')
      .set('Cookie', await cookieFor('ADMIN'))
      .set('Origin', 'http://localhost:3000')
      .send({ delta: 0, reason: 'Nothing' });

    expect(response.status).toBe(422);
    expect(prismaMock.loyaltyTransaction.create).not.toHaveBeenCalled();
  });
});
