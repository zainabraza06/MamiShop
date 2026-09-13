import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Custom requests and their conversations.
 *
 * The risks: reading someone else's conversation, a message carrying a photo
 * from anywhere on the internet, measurements borrowed from another account,
 * writing into a closed request, and an upload signature that lets a stranger
 * put anything into the shop's Cloudinary account.
 */

const prismaMock = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn() },
    customRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    customRequestMessage: { create: vi.fn(), findMany: vi.fn() },
    measurementProfile: { findFirst: vi.fn(), findMany: vi.fn() },
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
const CLOUD = 'momishop-test';
const OWN_PHOTO = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/momishop/custom-requests/dress.jpg`;

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

const newRequest = {
  title: 'Maroon bridal lehnga',
  description: 'Heavy zari work on the dupatta,\nfull sleeves, and a long flared skirt.',
  template: 'WOMENS_STITCHED',
};

const message = {
  id: 'msg_1',
  authorRole: 'STAFF',
  body: 'We can make this.',
  attachments: [],
  createdAt: new Date('2026-09-13T10:00:00Z'),
  author: { name: 'Sana (staff)' },
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
  process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  process.env.CLOUDINARY_API_KEY = 'key_123';
  process.env.CLOUDINARY_API_SECRET = 'secret_456';
  prismaMock.customRequest.count.mockResolvedValue(0);
  prismaMock.customRequest.create.mockResolvedValue({ id: 'req_1', number: 'CR-2026-000001' });
});

afterEach(() => {
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
});

describe('starting a request', () => {
  it('needs a signed-in customer', async () => {
    const response = await request(app)
      .post('/api/custom-requests')
      .set('Origin', ORIGIN)
      .send(newRequest);

    expect(response.status).toBe(401);
  });

  it('opens the conversation with the description, line breaks intact, and tells the shop', async () => {
    const cookie = await signedInAs('CUSTOMER');

    const response = await request(app)
      .post('/api/custom-requests')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...newRequest, attachments: [OWN_PHOTO] });

    expect(response.status).toBe(201);
    const { data } = prismaMock.customRequest.create.mock.calls[0][0];
    expect(data.number).toBe(`CR-${new Date().getFullYear()}-000001`);
    expect(data.messages.create).toMatchObject({
      authorRole: 'CUSTOMER',
      body: newRequest.description,
      attachments: [OWN_PHOTO],
    });
    expect(enqueueMock.mock.calls[0][0]).toBe('email.custom_request_to_staff');
  });

  it('refuses a photo linked from somewhere other than our own uploads', async () => {
    const cookie = await signedInAs('CUSTOMER');

    for (const url of [
      'https://evil.example/pixel.gif',
      `https://res.cloudinary.com/someone-else/image/upload/momishop/custom-requests/x.jpg`,
      `https://res.cloudinary.com/${CLOUD}/image/upload/other-folder/x.jpg`,
    ]) {
      const response = await request(app)
        .post('/api/custom-requests')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({ ...newRequest, attachments: [url] });
      expect(response.status, url).toBe(422);
    }

    expect(prismaMock.customRequest.create).not.toHaveBeenCalled();
  });

  it('will not use another customer’s measurements', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.measurementProfile.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/custom-requests')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...newRequest, measurementProfileId: 'profile_of_someone_else' });

    expect(response.status).toBe(422);
    expect(prismaMock.measurementProfile.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'profile_of_someone_else',
      userId: 'user_customer',
    });
    expect(prismaMock.customRequest.create).not.toHaveBeenCalled();
  });

  it('freezes a copy of the chosen measurements', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.measurementProfile.findFirst.mockResolvedValue({
      id: 'profile_1',
      template: 'WOMENS_STITCHED',
      unit: 'INCH',
      values: { bust: 36, waist: 30 },
    });

    await request(app)
      .post('/api/custom-requests')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...newRequest, measurementProfileId: 'profile_1' });

    expect(prismaMock.customRequest.create.mock.calls[0][0].data).toMatchObject({
      measurementProfileId: 'profile_1',
      measurementUnit: 'INCH',
      measurementSnapshot: { bust: 36, waist: 30 },
    });
  });
});

describe('the conversation, as the customer', () => {
  it('answers not found for someone else’s request, so ids cannot be probed', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customRequest.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/custom-requests/req_other').set('Cookie', cookie);

    expect(response.status).toBe(404);
    expect(prismaMock.customRequest.findFirst.mock.calls[0][0].where).toEqual({
      id: 'req_other',
      userId: 'user_customer',
    });
  });

  it('shows replies as coming from the shop, never from a named employee', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customRequest.findFirst.mockResolvedValue({
      id: 'req_1',
      status: 'OPEN',
      unreadByCustomer: true,
    });
    prismaMock.customRequestMessage.findMany.mockResolvedValue([message]);

    const response = await request(app)
      .get('/api/custom-requests/req_1/messages?after=2026-09-13T09:00:00Z')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.messages[0].authorName).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('Sana');
    // Reading the reply clears the unread flag.
    expect(prismaMock.customRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'req_1', unreadByCustomer: true },
      data: { unreadByCustomer: false },
    });
  });

  it('will not take a message on a closed request', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customRequest.findFirst.mockResolvedValue({
      id: 'req_1',
      status: 'CLOSED',
      unreadByCustomer: false,
    });

    const response = await request(app)
      .post('/api/custom-requests/req_1/messages')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ body: 'Hello?' });

    expect(response.status).toBe(409);
    expect(prismaMock.customRequestMessage.create).not.toHaveBeenCalled();
  });

  it('turns a burst of messages into one email for the shop', async () => {
    const cookie = await signedInAs('CUSTOMER');
    prismaMock.customRequest.findFirst.mockResolvedValue({
      id: 'req_1',
      status: 'OPEN',
      unreadByCustomer: false,
    });
    prismaMock.customRequestMessage.create.mockResolvedValue({
      ...message,
      authorRole: 'CUSTOMER',
      author: { name: 'Customer' },
    });

    for (const body of ['One more thing', 'and the sleeves']) {
      await request(app)
        .post('/api/custom-requests/req_1/messages')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({ body });
    }

    const [first, second] = enqueueMock.mock.calls.map((call) => call[2]);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.delaySeconds).toBeGreaterThan(0);
  });
});

describe('the conversation, as the shop', () => {
  it('is closed to customers', async () => {
    const cookie = await signedInAs('CUSTOMER');

    const response = await request(app).get('/api/admin/custom-requests').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });

  it('lets staff reply, marking it unread for the customer and emailing them', async () => {
    const cookie = await signedInAs('STAFF');
    prismaMock.customRequest.findUnique.mockResolvedValue({ id: 'req_1', status: 'OPEN' });
    prismaMock.customRequestMessage.create.mockResolvedValue(message);

    const response = await request(app)
      .post('/api/admin/custom-requests/req_1/messages')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ body: 'We can make this.' });

    expect(response.status).toBe(201);
    expect(response.body.message.authorName).toBe('Sana (staff)');
    expect(prismaMock.customRequest.update.mock.calls[0][0].data).toMatchObject({
      unreadByCustomer: true,
      unreadByStaff: false,
    });
    expect(enqueueMock.mock.calls[0][0]).toBe('email.custom_request_to_customer');
  });

  it('tells the customer in the conversation when a request is declined', async () => {
    const cookie = await signedInAs('STAFF');
    prismaMock.customRequest.findUnique.mockResolvedValue({
      id: 'req_1',
      number: 'CR-2026-000001',
      status: 'OPEN',
    });

    const response = await request(app)
      .patch('/api/admin/custom-requests/req_1/status')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ status: 'DECLINED', note: 'We do not work with leather.' });

    expect(response.status).toBe(200);
    const { data } = prismaMock.customRequestMessage.create.mock.calls[0][0];
    expect(data.authorRole).toBe('SYSTEM');
    expect(data.body).toContain('We do not work with leather.');
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe('custom_request.update');
  });
});

describe('photo uploads', () => {
  it('needs a signed-in customer', async () => {
    const response = await request(app).post('/api/uploads/signature').set('Origin', ORIGIN);
    expect(response.status).toBe(401);
  });

  it('explains when uploads are not set up', async () => {
    delete process.env.CLOUDINARY_API_SECRET;
    const cookie = await signedInAs('CUSTOMER');

    const response = await request(app)
      .post('/api/uploads/signature')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN);

    expect(response.status).toBe(503);
    expect(response.body.error).toContain('not set up');
  });

  it('signs one folder and image formats only, without revealing the secret', async () => {
    const cookie = await signedInAs('CUSTOMER');

    const response = await request(app)
      .post('/api/uploads/signature')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN);

    expect(response.status).toBe(200);
    const { timestamp, folder, allowedFormats, signature } = response.body;
    expect(folder).toBe('momishop/custom-requests');
    const expected = createHash('sha1')
      .update(`allowed_formats=${allowedFormats}&folder=${folder}&timestamp=${timestamp}secret_456`)
      .digest('hex');
    expect(signature).toBe(expected);
    expect(JSON.stringify(response.body)).not.toContain('secret_456');
  });
});
