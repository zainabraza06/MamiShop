import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Delivery and tax settings.
 *
 * The expensive mistakes: a settings change that leaves shoppers unable to
 * check out, a saved change that checkout keeps ignoring because of its cache,
 * and delivery times or tax rates that make no sense.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  shippingZone: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  shippingRate: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  taxRule: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { CACHE_KEYS } from '../src/lib/cache';
import { __setStoreForTesting, kv } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });
const ORIGIN = 'http://localhost:3000';

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

const zone = {
  id: 'zone_1',
  name: 'Lahore',
  country: 'PK',
  cities: ['Lahore'],
  states: [],
  priority: 0,
  isActive: true,
};

const rate = {
  id: 'rate_1',
  zoneId: 'zone_1',
  name: 'Standard',
  description: null,
  amount: 25_000,
  freeAbove: 500_000,
  codSurcharge: 0,
  minDays: 2,
  maxDays: 4,
  isActive: true,
  position: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
});

describe('who may see settings', () => {
  it('is closed to staff, who manage neither delivery nor tax', async () => {
    const cookie = await signedInAs('STAFF');

    const response = await request(app).get('/api/admin/settings').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });

  it('tells an admin which parts they may change', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.shippingZone.findMany.mockResolvedValue([{ ...zone, rates: [rate] }]);
    prismaMock.taxRule.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/admin/settings').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ canShipping: true, canTax: true });
  });
});

describe('delivery zones', () => {
  it('clears the cached rules, so checkout quotes what was just saved', async () => {
    const cookie = await signedInAs('ADMIN');
    await kv().set(CACHE_KEYS.shippingRules, [{ stale: true }], 600);
    prismaMock.shippingZone.create.mockResolvedValue({ id: 'zone_2', name: 'Karachi' });

    const response = await request(app)
      .post('/api/admin/shipping-zones')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ name: 'Karachi', cities: ['Karachi'] });

    expect(response.status).toBe(201);
    expect(await kv().get(CACHE_KEYS.shippingRules)).toBeNull();
  });

  it('will not switch off the last zone shoppers can check out in', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.shippingZone.findUnique.mockResolvedValue(zone);
    prismaMock.shippingZone.count.mockResolvedValue(0);

    const response = await request(app)
      .patch('/api/admin/shipping-zones/zone_1')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ isActive: false });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('only delivery zone');
    expect(prismaMock.shippingZone.update).not.toHaveBeenCalled();
  });

  it('will not delete it either', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.shippingZone.findUnique.mockResolvedValue(zone);
    prismaMock.shippingZone.count.mockResolvedValue(0);

    const response = await request(app)
      .delete('/api/admin/shipping-zones/zone_1')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN);

    expect(response.status).toBe(409);
    expect(prismaMock.shippingZone.delete).not.toHaveBeenCalled();
  });
});

describe('delivery options', () => {
  it('will not remove the only option in a zone that is switched on', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.shippingRate.findUnique.mockResolvedValue(rate);
    prismaMock.shippingZone.findUnique.mockResolvedValue({ name: 'Lahore', isActive: true });
    prismaMock.shippingRate.count.mockResolvedValue(0);

    const response = await request(app)
      .delete('/api/admin/shipping-rates/rate_1')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('only delivery option');
    expect(prismaMock.shippingRate.delete).not.toHaveBeenCalled();
  });

  it('lets it go when the zone itself is switched off', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.shippingRate.findUnique.mockResolvedValue(rate);
    prismaMock.shippingZone.findUnique.mockResolvedValue({ name: 'Lahore', isActive: false });

    const response = await request(app)
      .delete('/api/admin/shipping-rates/rate_1')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN);

    expect(response.status).toBe(200);
    expect(prismaMock.shippingRate.delete).toHaveBeenCalled();
  });

  it('refuses a longest delivery time shorter than the quickest', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.shippingRate.findUnique.mockResolvedValue(rate);

    // Only the minimum is sent; it is checked against the saved maximum of 4.
    const response = await request(app)
      .patch('/api/admin/shipping-rates/rate_1')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ minDays: 9 });

    expect(response.status).toBe(422);
    expect(prismaMock.shippingRate.update).not.toHaveBeenCalled();
  });
});

describe('tax rules', () => {
  it('stores a rate in basis points and clears the cached rules', async () => {
    const cookie = await signedInAs('ADMIN');
    await kv().set(CACHE_KEYS.taxRules, [{ stale: true }], 600);
    prismaMock.taxRule.create.mockResolvedValue({ id: 'tax_1', name: 'Sales tax' });

    const response = await request(app)
      .post('/api/admin/tax-rules')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ name: 'Sales tax', rateBps: 1700 });

    expect(response.status).toBe(201);
    expect(prismaMock.taxRule.create.mock.calls[0][0].data.rateBps).toBe(1700);
    expect(await kv().get(CACHE_KEYS.taxRules)).toBeNull();
  });

  it('refuses a rate over 100%', async () => {
    const cookie = await signedInAs('ADMIN');

    const response = await request(app)
      .post('/api/admin/tax-rules')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ name: 'Typo', rateBps: 17_000 });

    expect(response.status).toBe(422);
    expect(prismaMock.taxRule.create).not.toHaveBeenCalled();
  });
});
