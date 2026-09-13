import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The audit log screen.
 *
 * It must be readable only by those allowed to read it, filter the way the
 * tabs promise, page without skipping entries, and offer no way at all to
 * change what it records.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  auditLog: { findMany: vi.fn(), groupBy: vi.fn(), create: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { __setStoreForTesting } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });

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

function entry(id: string, action: string) {
  return {
    id,
    action,
    entityType: 'Order',
    entityId: 'order_1',
    summary: `${action} happened`,
    actorEmail: 'admin@momishop.pk',
    actorRole: 'ADMIN',
    diff: null,
    createdAt: new Date('2026-09-13T10:00:00Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.auditLog.groupBy.mockResolvedValue([]);
});

describe('reading the audit log', () => {
  it('is closed to staff, who have no audit.read', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('STAFF'));

    const response = await request(app)
      .get('/api/admin/audit')
      .set('Cookie', await cookieFor('STAFF'));

    expect(response.status).toBe(403);
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('filters an area by the part of the action before the dot', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.auditLog.findMany.mockResolvedValue([entry('a1', 'order.refund')]);

    const response = await request(app)
      .get('/api/admin/audit?area=order&actor=admin')
      .set('Cookie', await cookieFor('ADMIN'));

    expect(response.status).toBe(200);
    const { where, select } = prismaMock.auditLog.findMany.mock.calls[0][0];
    // "order." rather than "order", so the area never matches "orderly.something".
    expect(where.action).toEqual({ startsWith: 'order.' });
    expect(where.actorEmail).toEqual({ contains: 'admin', mode: 'insensitive' });
    // The hashed IP and user agent are not for browsing.
    expect(select.ipHash).toBeUndefined();
    expect(select.userAgent).toBeUndefined();
  });

  it('counts each area across all of its actions', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.groupBy.mockResolvedValue([
      { action: 'order.refund', _count: { _all: 2 } },
      { action: 'order.status_change', _count: { _all: 5 } },
      { action: 'coupon.create', _count: { _all: 1 } },
    ]);

    const response = await request(app)
      .get('/api/admin/audit')
      .set('Cookie', await cookieFor('ADMIN'));

    expect(response.body.areas).toEqual([
      { name: 'coupon', count: 1 },
      { name: 'order', count: 7 },
    ]);
  });

  it('hands back a cursor only when there are older entries', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));
    prismaMock.auditLog.findMany.mockResolvedValue([
      entry('a1', 'order.refund'),
      entry('a2', 'order.refund'),
      entry('a3', 'order.refund'),
    ]);

    const response = await request(app)
      .get('/api/admin/audit?limit=2')
      .set('Cookie', await cookieFor('ADMIN'));

    expect(response.body.items).toHaveLength(2);
    expect(response.body.nextCursor).toBe('a2');
  });

  it('refuses an area that is not a plain word', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('ADMIN'));

    const response = await request(app)
      .get('/api/admin/audit?area=order%25')
      .set('Cookie', await cookieFor('ADMIN'));

    expect(response.status).toBe(422);
  });
});

describe('changing the audit log', () => {
  it('has no route to write, edit or delete an entry', async () => {
    prismaMock.user.findUnique.mockResolvedValue(account('SUPER_ADMIN'));
    const cookie = await cookieFor('SUPER_ADMIN');

    for (const call of [
      request(app).post('/api/admin/audit').send({ action: 'order.refund' }),
      request(app).patch('/api/admin/audit/a1').send({ summary: 'nothing to see' }),
      request(app).delete('/api/admin/audit/a1'),
    ]) {
      const response = await call.set('Cookie', cookie).set('Origin', 'http://localhost:3000');
      expect(response.status).toBe(404);
    }

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
