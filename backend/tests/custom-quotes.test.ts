import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Price quotes for custom pieces.
 *
 * Money changes hands here, so the risks are the expensive ones: staff setting
 * a price, a customer accepting someone else's quote or an expired one, one
 * quote turning into two orders, a total that differs from checkout's, and
 * cash on delivery above the limit the delivery policy promises.
 */

const prismaMock = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn() },
    customRequest: { findUnique: vi.fn(), update: vi.fn() },
    customQuote: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    customRequestMessage: { create: vi.fn() },
    order: { create: vi.fn(), count: vi.fn() },
    address: { findFirst: vi.fn() },
    shippingZone: { findMany: vi.fn() },
    taxRule: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mock));
  return mock;
});

const enqueueMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));
vi.mock('../src/services/jobs', () => ({ enqueue: enqueueMock }));

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { __setStoreForTesting } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });
const ORIGIN = 'http://localhost:3000';

async function signedInAs(role: string, id = `user_${role.toLowerCase()}`) {
  prismaMock.user.findUnique.mockResolvedValue({
    id,
    email: `${role.toLowerCase()}@example.com`,
    name: role,
    image: null,
    role,
    status: 'ACTIVE',
    permissions: [],
    deletedAt: null,
  });
  const token = await signSessionToken({
    id,
    role: role as 'STAFF',
    status: 'ACTIVE',
    permissions: [],
  });
  return `momishop.session=${token}`;
}

const zones = [
  {
    id: 'zone_punjab',
    name: 'Punjab',
    country: 'PK',
    cities: [],
    states: ['Punjab'],
    priority: 0,
    isActive: true,
    rates: [
      {
        id: 'rate_standard',
        zoneId: 'zone_punjab',
        name: 'Standard',
        description: null,
        amount: 25_000,
        freeAbove: null,
        codSurcharge: 10_000,
        minDays: 2,
        maxDays: 4,
        isActive: true,
        position: 0,
      },
    ],
  },
];

function pendingQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote_1',
    amount: 1_500_000,
    stitchingDays: 10,
    note: null,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 3 * 86_400_000),
    order: null,
    request: {
      id: 'req_1',
      number: 'CR-2026-000001',
      title: 'Maroon bridal lehnga',
      status: 'QUOTED',
      template: 'WOMENS_STITCHED',
      measurementProfileId: 'profile_1',
      measurementUnit: 'INCH',
      measurementSnapshot: { bust: 36, waist: 30 },
      user: { email: 'customer@example.com', phone: '+923001234567' },
    },
    ...overrides,
  };
}

const acceptBody = {
  phone: '03001234567',
  shippingAddress: {
    fullName: 'Ayesha Khan',
    phone: '03001234567',
    line1: '12 Garden Town',
    city: 'Lahore',
    state: 'Punjab',
    country: 'PK',
    type: 'SHIPPING',
  },
  shippingRateId: 'rate_standard',
  paymentMethod: 'COD',
  acceptTerms: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
  prismaMock.shippingZone.findMany.mockResolvedValue(zones);
  prismaMock.taxRule.findMany.mockResolvedValue([]);
  prismaMock.order.count.mockResolvedValue(41);
  prismaMock.customQuote.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.order.create.mockImplementation(async (args: { data: { orderNumber: string } }) => ({
    id: 'order_1',
    orderNumber: args.data.orderNumber,
    grandTotal: 0,
    currency: 'PKR',
    paymentMethod: 'COD',
  }));
});

describe('sending a quote', () => {
  it('is for admins; staff may talk to customers but not set a price', async () => {
    const cookie = await signedInAs('STAFF');

    const response = await request(app)
      .post('/api/admin/custom-requests/req_1/quotes')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ amount: 1_500_000, stitchingDays: 10 });

    expect(response.status).toBe(403);
    expect(prismaMock.customQuote.create).not.toHaveBeenCalled();
  });

  it('replaces any quote still on offer and posts the new one into the conversation', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.customRequest.findUnique.mockResolvedValue({
      id: 'req_1',
      number: 'CR-2026-000001',
      status: 'QUOTED',
    });
    prismaMock.customQuote.create.mockResolvedValue({ ...pendingQuote(), request: undefined });

    const response = await request(app)
      .post('/api/admin/custom-requests/req_1/quotes')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ amount: 1_500_000, stitchingDays: 10, note: 'Gold zari, net dupatta.' });

    expect(response.status).toBe(201);
    expect(prismaMock.customQuote.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'req_1', status: 'PENDING' },
      data: { status: 'WITHDRAWN' },
    });
    const { data: quote } = prismaMock.customQuote.create.mock.calls[0][0];
    const validFor = quote.expiresAt.getTime() - Date.now();
    expect(validFor).toBeGreaterThan(6.9 * 86_400_000);
    expect(prismaMock.customRequestMessage.create.mock.calls[0][0].data).toMatchObject({
      authorRole: 'STAFF',
      quoteId: 'quote_1',
    });
    expect(prismaMock.customRequest.update.mock.calls[0][0].data.status).toBe('QUOTED');
  });

  it('refuses a quote on a request that has already become an order', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.customRequest.findUnique.mockResolvedValue({
      id: 'req_1',
      number: 'CR-2026-000001',
      status: 'ORDERED',
    });

    const response = await request(app)
      .post('/api/admin/custom-requests/req_1/quotes')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ amount: 1_500_000, stitchingDays: 10 });

    expect(response.status).toBe(409);
  });
});

describe('accepting a quote', () => {
  it('answers not found for someone else’s quote', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customQuote.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/accept')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(acceptBody);

    expect(response.status).toBe(404);
    expect(prismaMock.customQuote.findFirst.mock.calls[0][0].where).toEqual({
      id: 'quote_1',
      requestId: 'req_1',
      request: { userId: 'user_customer' },
    });
  });

  it('refuses a quote past its date', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customQuote.findFirst.mockResolvedValue(
      pendingQuote({ expiresAt: new Date(Date.now() - 1000) }),
    );

    const response = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/accept')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(acceptBody);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('expired');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('places an order priced as checkout would, with the agreed measurements', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customQuote.findFirst.mockResolvedValue(pendingQuote());

    const response = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/accept')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(acceptBody);

    expect(response.status).toBe(201);
    expect(response.body.orderNumber).toMatch(/^MS-\d{4}-/);

    const { data } = prismaMock.order.create.mock.calls[0][0];
    // Rs 15,000 piece + Rs 250 delivery + Rs 100 cash on delivery surcharge.
    expect(data).toMatchObject({
      subtotal: 1_500_000,
      shippingTotal: 35_000,
      grandTotal: 1_535_000,
      paymentMethod: 'COD',
    });
    expect(data.items.create[0]).toMatchObject({
      productId: null,
      productName: 'Maroon bridal lehnga',
      sku: 'CR-2026-000001',
      unitPrice: 1_500_000,
      measurementSnapshot: { bust: 36, waist: 30 },
      measurementTemplate: 'WOMENS_STITCHED',
    });

    // The quote is claimed only while still pending, and the request is marked ordered.
    expect(prismaMock.customQuote.updateMany.mock.calls[0][0].where).toEqual({
      id: 'quote_1',
      status: 'PENDING',
    });
    expect(prismaMock.customRequest.update.mock.calls[0][0].data.status).toBe('ORDERED');
    expect(enqueueMock.mock.calls.map((call) => call[0])).toContain('email.order_confirmation');
  });

  it('never turns one quote into two orders', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customQuote.findFirst.mockResolvedValue(pendingQuote());
    // Another tab accepted it between the check and the claim.
    prismaMock.customQuote.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/accept')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(acceptBody);

    expect(response.status).toBe(409);
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('keeps cash on delivery within the Rs 50,000 limit, and allows bank transfer above it', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customQuote.findFirst.mockResolvedValue(pendingQuote({ amount: 8_500_000 }));

    const cod = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/accept')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(acceptBody);
    expect(cod.status).toBe(422);
    expect(prismaMock.order.create).not.toHaveBeenCalled();

    const transfer = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/accept')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...acceptBody, paymentMethod: 'BANK_TRANSFER' });
    expect(transfer.status).toBe(201);
    expect(prismaMock.order.create.mock.calls[0][0].data.paymentMethod).toBe('BANK_TRANSFER');
  });

  it('previews the same total it will charge', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customQuote.findFirst.mockResolvedValue(pendingQuote());

    const response = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/preview')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ state: 'Punjab', city: 'Lahore', paymentMethod: 'COD' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      grandTotal: 1_535_000,
      selectedRateId: 'rate_standard',
      codAllowed: true,
    });
  });
});

describe('declining a quote', () => {
  it('reopens the conversation and tells the shop', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customQuote.findFirst.mockResolvedValue({ id: 'quote_1', status: 'PENDING' });

    const response = await request(app)
      .post('/api/custom-requests/req_1/quotes/quote_1/decline')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ reason: 'A little over my budget' });

    expect(response.status).toBe(200);
    expect(prismaMock.customQuote.update.mock.calls[0][0].data.status).toBe('DECLINED');
    expect(prismaMock.customRequest.update.mock.calls[0][0].data).toMatchObject({
      status: 'OPEN',
      unreadByStaff: true,
    });
    expect(prismaMock.customRequestMessage.create.mock.calls[0][0].data.body).toBe(
      'Quote declined: A little over my budget',
    );
  });
});
