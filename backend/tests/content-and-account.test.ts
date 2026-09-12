import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The endpoints behind the storefront's help, policy and account pages.
 *
 * The database is mocked: what is under test is who may call these and what
 * they refuse, not the queries themselves.
 */

const prismaMock = vi.hoisted(() => ({
  page: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  order: { findMany: vi.fn(), findFirst: vi.fn() },
  wishlistItem: { count: vi.fn() },
  measurementProfile: { count: vi.fn() },
  loyaltyAccount: { findUnique: vi.fn() },
  dataRequest: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}));

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  contactEnquiryEmail: vi.fn(() => ({ subject: 'Enquiry', html: '<p>x</p>', text: 'x' })),
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));
vi.mock('../src/services/email', () => emailMock);

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { __setStoreForTesting } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });

const customer = {
  id: 'user_1',
  email: 'customer@momishop.pk',
  name: 'Customer',
  image: null,
  role: 'CUSTOMER',
  status: 'ACTIVE',
  permissions: [],
  deletedAt: null,
};

async function signedIn(): Promise<string> {
  const token = await signSessionToken({
    id: 'user_1',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    permissions: [],
  });
  return `momishop.session=${token}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  emailMock.sendEmail.mockResolvedValue(undefined);
});

describe('editorial pages', () => {
  it('serves a published page and lets a shared cache hold it', async () => {
    prismaMock.page.findFirst.mockResolvedValue({
      slug: 'terms',
      title: 'Terms & Conditions',
      body: 'One.\n\nTwo.',
      metaTitle: null,
      metaDescription: null,
      updatedAt: new Date('2026-01-01'),
    });

    const response = await request(app).get('/api/pages/terms');

    expect(response.status).toBe(200);
    expect(response.body.page.title).toBe('Terms & Conditions');
    expect(response.headers['cache-control']).toContain('s-maxage');
  });

  it('treats an unpublished or unknown page as missing', async () => {
    prismaMock.page.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/pages/draft-policy');

    expect(response.status).toBe(404);
    // The query itself excludes unpublished rows, so a draft cannot be fetched
    // by guessing its slug.
    expect(prismaMock.page.findFirst.mock.calls[0][0].where).toMatchObject({ isPublished: true });
  });
});

describe('contact form', () => {
  const enquiry = {
    name: 'Ayesha Khan',
    email: 'ayesha@example.com',
    subject: 'Sleeve length',
    message: 'Could you check the sleeve length on my order before you cut it? Thank you.',
  };

  it('sends the enquiry to the shop, with the customer as reply-to', async () => {
    const response = await request(app).post('/api/contact').send(enquiry);

    expect(response.status).toBe(201);
    expect(emailMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'ayesha@example.com' }),
    );
  });

  it('answers a bot the same way but sends nothing', async () => {
    const response = await request(app)
      .post('/api/contact')
      .send({ ...enquiry, website: 'http://spam.example' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ok: true,
      message: 'Thanks — we will reply within one working day.',
    });
    expect(emailMock.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a message too short to act on', async () => {
    const response = await request(app)
      .post('/api/contact')
      .send({ ...enquiry, message: 'help' });

    expect(response.status).toBe(422);
    expect(emailMock.sendEmail).not.toHaveBeenCalled();
  });
});

describe('order tracking', () => {
  it('requires both the order number and the email', async () => {
    const response = await request(app).get('/api/orders/track?orderNumber=MS-2026-000001');

    expect(response.status).toBe(422);
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
  });

  it('answers not found when the pair does not match an order', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    const response = await request(app).get(
      '/api/orders/track?orderNumber=MS-2026-000001&email=someone@example.com',
    );

    expect(response.status).toBe(404);
  });
});

describe('the account area', () => {
  it('refuses every account endpoint to an anonymous caller', async () => {
    for (const path of ['/api/account/overview', '/api/account/data-requests']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect(
      (await request(app).post('/api/account/data-requests').send({ kind: 'EXPORT' })).status,
    ).toBe(401);
  });

  it('returns the signed-in customer their own summary', async () => {
    prismaMock.user.findUnique.mockResolvedValue(customer);
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.wishlistItem.count.mockResolvedValue(2);
    prismaMock.measurementProfile.count.mockResolvedValue(1);
    prismaMock.loyaltyAccount.findUnique.mockResolvedValue({ balance: 150 });

    const response = await request(app)
      .get('/api/account/overview')
      .set('Cookie', await signedIn());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ wishlistCount: 2, loyaltyBalance: 150 });
    // Scoped to the caller, never to an id from the request.
    expect(prismaMock.order.findMany.mock.calls[0][0].where).toEqual({ userId: 'user_1' });
  });

  it('records a data request', async () => {
    prismaMock.user.findUnique.mockResolvedValue(customer);
    prismaMock.dataRequest.findFirst.mockResolvedValue(null);
    prismaMock.dataRequest.create.mockResolvedValue({
      id: 'req_1',
      kind: 'EXPORT',
      status: 'PENDING',
      createdAt: new Date(),
    });

    const response = await request(app)
      .post('/api/account/data-requests')
      .set('Cookie', await signedIn())
      .send({ kind: 'EXPORT' });

    expect(response.status).toBe(201);
    expect(prismaMock.dataRequest.create.mock.calls[0][0].data).toEqual({
      userId: 'user_1',
      kind: 'EXPORT',
    });
  });

  it('refuses a second request of the same kind while one is open', async () => {
    prismaMock.user.findUnique.mockResolvedValue(customer);
    prismaMock.dataRequest.findFirst.mockResolvedValue({ id: 'req_1' });

    const response = await request(app)
      .post('/api/account/data-requests')
      .set('Cookie', await signedIn())
      .send({ kind: 'DELETE' });

    expect(response.status).toBe(409);
    expect(prismaMock.dataRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a kind it does not recognise', async () => {
    prismaMock.user.findUnique.mockResolvedValue(customer);

    const response = await request(app)
      .post('/api/account/data-requests')
      .set('Cookie', await signedIn())
      .send({ kind: 'EVERYTHING' });

    expect(response.status).toBe(422);
  });
});
