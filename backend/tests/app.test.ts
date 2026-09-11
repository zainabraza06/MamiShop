import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The HTTP surface, driven through the real Express app with the database
 * mocked. These cover what sits in front of every route — error shape, CSRF
 * guard, sessions, rate limits — plus the routes that must refuse a request
 * before any query runs.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { __setStoreForTesting } from '../src/lib/redis';

const APP_ORIGIN = 'http://localhost:3000';
const app = createApp({ appUrl: APP_ORIGIN, corsOrigins: [], trustProxy: 'false' });

const activeCustomer = {
  id: 'user_1',
  email: 'customer@momishop.pk',
  name: 'Customer',
  image: null,
  role: 'CUSTOMER',
  status: 'ACTIVE',
  permissions: [],
  deletedAt: null,
};

async function sessionCookie(): Promise<string> {
  const token = await signSessionToken({
    id: 'user_1',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    permissions: [],
  });
  return `momishop.session=${token}`;
}

function setCookies(response: request.Response): string[] {
  const header = response.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? header : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('baseline behaviour', () => {
  it('answers an unknown endpoint with a JSON 404', async () => {
    const response = await request(app).get('/api/no-such-thing');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('marks API responses uncacheable and does not advertise the framework', async () => {
    const response = await request(app).get('/api/auth/session');

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects a malformed JSON body with a 400', async () => {
    const response = await request(app)
      .post('/api/cart/items')
      .set('Content-Type', 'application/json')
      .send('{"productId": ');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_JSON');
  });

  it('rejects a request that was not sent as JSON', async () => {
    const response = await request(app).post('/api/cart/items').send('productId=1');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_JSON');
  });

  it('returns field-level issues for an invalid body', async () => {
    const response = await request(app).post('/api/cart/items').send({ quantity: -1 });

    expect(response.status).toBe(422);
    expect(response.body.issues.map((i: { field: string }) => i.field)).toContain('productId');
  });
});

describe('cross-site request guard', () => {
  it('refuses a state-changing request from another origin', async () => {
    const response = await request(app)
      .post('/api/cart/items')
      .set('Origin', 'https://attacker.example')
      .send({});

    expect(response.status).toBe(403);
  });

  it('refuses a cross-site request that hides its origin', async () => {
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({});

    expect(response.status).toBe(403);
  });

  it('lets the storefront origin through', async () => {
    const response = await request(app).post('/api/cart/items').set('Origin', APP_ORIGIN).send({});

    expect(response.status).toBe(422);
  });

  it('never blocks reads', async () => {
    const response = await request(app)
      .get('/api/auth/session')
      .set('Origin', 'https://attacker.example');

    expect(response.status).toBe(200);
  });
});

describe('sessions', () => {
  it('reports no user without a session cookie', async () => {
    const response = await request(app).get('/api/auth/session');

    expect(response.body).toEqual({ user: null });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns the live user for a valid session', async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeCustomer);

    const response = await request(app)
      .get('/api/auth/session')
      .set('Cookie', await sessionCookie());

    expect(response.body.user).toMatchObject({ id: 'user_1', email: 'customer@momishop.pk' });
  });

  it('clears a forged session cookie', async () => {
    const response = await request(app)
      .get('/api/auth/session')
      .set('Cookie', 'momishop.session=forged.token.value');

    expect(response.body).toEqual({ user: null });
    expect(setCookies(response).some((c) => c.startsWith('momishop.session=;'))).toBe(true);
  });

  it('clears the session of an account suspended after sign-in', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...activeCustomer, status: 'SUSPENDED' });

    const response = await request(app)
      .get('/api/auth/session')
      .set('Cookie', await sessionCookie());

    expect(response.body).toEqual({ user: null });
    expect(setCookies(response).some((c) => c.startsWith('momishop.session=;'))).toBe(true);
  });

  it('reissues a session more than a day old, so active customers stay signed in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const cookie = await sessionCookie();

    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    prismaMock.user.findUnique.mockResolvedValue(activeCustomer);

    const response = await request(app).get('/api/auth/session').set('Cookie', cookie);

    const renewed = setCookies(response).find((c) => c.startsWith('momishop.session='));
    expect(renewed).toBeDefined();
    expect(renewed).not.toMatch(/^momishop\.session=;/);
    expect(renewed).toContain('HttpOnly');
  });

  it('does not reissue a fresh session', async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeCustomer);

    const response = await request(app)
      .get('/api/auth/session')
      .set('Cookie', await sessionCookie());

    expect(setCookies(response)).toEqual([]);
  });

  it('gives the same answer for any unusable credentials', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'nope' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'Those details do not match an account. Please check and try again.',
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('clears the session cookie on sign-out', async () => {
    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(200);
    expect(setCookies(response).some((c) => c.startsWith('momishop.session=;'))).toBe(true);
  });
});

describe('access control', () => {
  it('requires sign-in for the admin area', async () => {
    const response = await request(app).get('/api/admin/shell');
    expect(response.status).toBe(401);
  });

  it('refuses the admin area to a customer', async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeCustomer);

    const response = await request(app)
      .get('/api/admin/dashboard')
      .set('Cookie', await sessionCookie());

    expect(response.status).toBe(403);
  });

  it('requires sign-in to save to a wishlist', async () => {
    const response = await request(app).post('/api/wishlist').send({ productId: 'p1' });
    expect(response.status).toBe(401);
  });

  it('fails closed when no cron secret is configured', async () => {
    const response = await request(app)
      .post('/api/cron/jobs')
      .set('Authorization', 'Bearer anything');

    expect(response.status).toBe(403);
  });

  it('refuses a cron call with the wrong secret', async () => {
    process.env.CRON_SECRET = 'the-real-cron-secret';

    const response = await request(app)
      .get('/api/cron/abandoned-carts')
      .set('Authorization', 'Bearer a-guess');

    expect(response.status).toBe(403);
  });
});

describe('rate limiting', () => {
  it('throttles newsletter signups and says when to retry', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await request(app).post('/api/newsletter').send({ email: 'x' });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      }
    }

    expect(statuses.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(statuses[5]).toBe(429);
  });
});

describe('health', () => {
  it('reports healthy when the database answers', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.checks.database.status).toBe('ok');
  });

  it('returns 503 when the database is down', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('down');
  });
});
