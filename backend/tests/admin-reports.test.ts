import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sales reports.
 *
 * The numbers must agree with the dashboard, days must be Pakistan days with
 * the quiet ones still shown, and the spreadsheet must neither leak customer
 * details nor run a formula someone typed into a coupon code.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  order: { aggregate: vi.fn(), count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  orderItem: { groupBy: vi.fn() },
  $queryRaw: vi.fn(),
  auditLog: { create: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { __setStoreForTesting } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });

async function signedInAs(role: string) {
  prismaMock.user.findUnique.mockResolvedValue({
    id: `user_${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@momishop.pk`,
    name: role,
    image: null,
    role,
    status: 'ACTIVE',
    permissions: [],
    deletedAt: null,
  });
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

  prismaMock.order.aggregate.mockImplementation(async (args: { _sum: Record<string, true> }) =>
    args._sum.grandTotal
      ? { _sum: { grandTotal: 100_001, discountTotal: 5_000 }, _count: { _all: 2 } }
      : { _sum: { refundedTotal: 20_000 } },
  );
  prismaMock.order.count.mockResolvedValue(1);
  prismaMock.order.groupBy.mockResolvedValue([
    { paymentMethod: 'COD', _count: { _all: 2 }, _sum: { grandTotal: 100_001 } },
  ]);
  prismaMock.orderItem.groupBy.mockResolvedValue([
    { productName: 'Noor Abaya', _sum: { quantity: 3, lineTotal: 90_000 } },
  ]);
  prismaMock.$queryRaw.mockResolvedValue([
    { day: '2026-09-10', orders: 2, revenue: BigInt(100_001) },
  ]);
});

describe('who may see reports', () => {
  it('is closed to customers', async () => {
    const cookie = await signedInAs('CUSTOMER');

    const response = await request(app).get('/api/admin/reports').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });

  it('is open to staff, who may read but not download', async () => {
    const cookie = await signedInAs('STAFF');

    const response = await request(app)
      .get('/api/admin/reports?from=2026-09-09&to=2026-09-11')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.canExport).toBe(false);
  });
});

describe('the figures', () => {
  it('counts revenue the way the dashboard does', async () => {
    const cookie = await signedInAs('ADMIN');

    const response = await request(app)
      .get('/api/admin/reports?from=2026-09-09&to=2026-09-11')
      .set('Cookie', cookie);

    const { where } = prismaMock.order.aggregate.mock.calls[0][0];
    expect(where.status.notIn).toEqual(['CANCELLED', 'REFUNDED']);
    expect(response.body.summary).toEqual({
      revenue: 100_001,
      orders: 2,
      // Rounded to whole paisa.
      averageOrder: 50_001,
      discounts: 5_000,
      refunded: 20_000,
      cancelled: 1,
    });
  });

  it('uses Pakistan days, starting at midnight in Lahore', async () => {
    const cookie = await signedInAs('ADMIN');

    await request(app)
      .get('/api/admin/reports?from=2026-09-09&to=2026-09-11')
      .set('Cookie', cookie);

    const { where } = prismaMock.order.aggregate.mock.calls[0][0];
    expect(where.placedAt.gte.toISOString()).toBe('2026-09-08T19:00:00.000Z');
    expect(where.placedAt.lt.toISOString()).toBe('2026-09-11T19:00:00.000Z');
  });

  it('shows every day in the range, including the quiet ones', async () => {
    const cookie = await signedInAs('ADMIN');

    const response = await request(app)
      .get('/api/admin/reports?from=2026-09-09&to=2026-09-11')
      .set('Cookie', cookie);

    expect(response.body.byDay).toEqual([
      { day: '2026-09-09', orders: 0, revenue: 0 },
      { day: '2026-09-10', orders: 2, revenue: 100_001 },
      { day: '2026-09-11', orders: 0, revenue: 0 },
    ]);
  });

  it('refuses a range that ends before it starts, runs past a year, or is not a date', async () => {
    const cookie = await signedInAs('ADMIN');

    for (const query of [
      'from=2026-09-11&to=2026-09-01',
      'from=2025-01-01&to=2026-09-01',
      'from=2026-02-30&to=2026-03-02',
      'from=yesterday',
    ]) {
      const response = await request(app).get(`/api/admin/reports?${query}`).set('Cookie', cookie);
      expect(response.status, query).toBe(422);
    }
  });
});

describe('downloading orders', () => {
  const order = {
    orderNumber: 'MS-2026-000001',
    placedAt: new Date('2026-09-10T20:30:00Z'),
    status: 'DELIVERED',
    paymentMethod: 'COD',
    paymentStatus: 'PAID',
    subtotal: 750_000,
    discountTotal: 0,
    shippingTotal: 25_000,
    taxTotal: 0,
    grandTotal: 775_000,
    refundedTotal: 0,
    couponCode: '=HYPERLINK("http://evil.example")',
  };

  it('is refused to staff, who may read reports but not take the data away', async () => {
    const cookie = await signedInAs('STAFF');

    const response = await request(app)
      .get('/api/admin/reports/orders.csv?from=2026-09-09&to=2026-09-11')
      .set('Cookie', cookie);

    expect(response.status).toBe(403);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
  });

  it('writes a spreadsheet with no customer details and no live formulas', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.order.findMany.mockResolvedValue([order]);

    const response = await request(app)
      .get('/api/admin/reports/orders.csv?from=2026-09-09&to=2026-09-11')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(
      'momishop-orders-2026-09-09-to-2026-09-11.csv',
    );

    const { select } = prismaMock.order.findMany.mock.calls[0][0];
    for (const personal of ['email', 'phone', 'shippingSnapshot', 'userId']) {
      expect(select, personal).not.toHaveProperty(personal);
    }

    const [, row] = response.text.replace(/^﻿/, '').trim().split('\r\n');
    // 20:30 UTC on the 10th is 01:30 on the 11th in Pakistan.
    expect(row).toContain('2026-09-11 01:30');
    expect(row).toContain('7750.00');
    // The formula is kept as text: quoted, with a leading apostrophe.
    expect(row).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
  });

  it('records who downloaded what', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.order.findMany.mockResolvedValue([order]);

    await request(app)
      .get('/api/admin/reports/orders.csv?from=2026-09-09&to=2026-09-11')
      .set('Cookie', cookie);

    const { data } = prismaMock.auditLog.create.mock.calls[0][0];
    expect(data.action).toBe('report.export');
    expect(data.summary).toBe('Downloaded 1 orders from 2026-09-09 to 2026-09-11');
  });
});
