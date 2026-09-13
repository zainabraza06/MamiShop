import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Staff accounts.
 *
 * Nearly every test here is about privilege escalation, because that is what
 * a staff screen gets wrong: a role handed out by someone not senior enough, a
 * permission granted by someone who never had it, someone changing their own
 * access, and a shop left with no super admin at all.
 */

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));
vi.mock('../src/lib/password', () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
  verifyPassword: vi.fn(),
}));

import { createApp } from '../src/app';
import { signSessionToken } from '../src/auth/session-token';
import { __setStoreForTesting } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });
const ORIGIN = 'http://localhost:3000';

/** The signed-in user; `getCurrentUser` looks them up with findUnique. */
function signedInAs(role: string, permissions: string[] = []) {
  const user = {
    id: 'user_actor',
    email: 'actor@momishop.pk',
    name: 'Actor',
    image: null,
    role,
    status: 'ACTIVE',
    permissions,
    deletedAt: null,
  };
  prismaMock.user.findUnique.mockResolvedValue(user);
  return signSessionToken({
    id: user.id,
    role: role as 'STAFF',
    status: 'ACTIVE',
    permissions,
  }).then((token) => `momishop.session=${token}`);
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_target',
    name: 'Sana',
    email: 'sana@momishop.pk',
    role: 'STAFF',
    status: 'ACTIVE',
    permissions: [],
    lastLoginAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const newStaff = {
  name: 'Sana',
  email: 'sana@momishop.pk',
  role: 'STAFF',
  permissions: [],
  status: 'ACTIVE',
  password: 'workshop-2026',
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
});

describe('seeing staff accounts', () => {
  it('is for super admins; an ordinary admin is refused', async () => {
    const cookie = await signedInAs('ADMIN');

    const response = await request(app).get('/api/admin/staff').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });

  it('marks your own row, and which rows you may change', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findMany.mockResolvedValue([
      member({ id: 'user_actor', role: 'SUPER_ADMIN' }),
      member(),
    ]);

    const response = await request(app).get('/api/admin/staff').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ isSelf: true, canManage: false });
    expect(response.body.items[1]).toMatchObject({ isSelf: false, canManage: true });
  });
});

describe('adding staff', () => {
  it('stores a hash of the starting password, never the password', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(member());

    const response = await request(app)
      .post('/api/admin/staff')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(newStaff);

    expect(response.status).toBe(201);
    const { data } = prismaMock.user.create.mock.calls[0][0];
    expect(data.passwordHash).toBe('hashed:workshop-2026');
    expect(data).not.toHaveProperty('password');
    expect(JSON.stringify(prismaMock.auditLog.create.mock.calls)).not.toContain('workshop-2026');
  });

  it('insists on a starting password for a brand new account', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/admin/staff')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...newStaff, password: undefined });

    expect(response.status).toBe(422);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('promotes an existing customer rather than creating a second account', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user_customer',
      role: 'CUSTOMER',
      email: 'sana@momishop.pk',
    });
    prismaMock.user.update.mockResolvedValue(member({ id: 'user_customer' }));

    const response = await request(app)
      .post('/api/admin/staff')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...newStaff, password: undefined });

    expect(response.status).toBe(201);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update.mock.calls[0][0].data.role).toBe('STAFF');
  });

  it('refuses an email that already has a staff account', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user_target',
      role: 'ADMIN',
      email: 'sana@momishop.pk',
    });

    const response = await request(app)
      .post('/api/admin/staff')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(newStaff);

    expect(response.status).toBe(409);
  });
});

describe('privilege escalation', () => {
  it('stops someone giving a role as senior as their own', async () => {
    // A staff member who was granted staff.write still cannot create an admin.
    const cookie = await signedInAs('STAFF', ['staff.write']);

    const response = await request(app)
      .post('/api/admin/staff')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...newStaff, role: 'ADMIN' });

    expect(response.status).toBe(403);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('stops someone granting a permission they do not have', async () => {
    const cookie = await signedInAs('ADMIN', ['staff.write']);
    prismaMock.user.findFirst.mockResolvedValue(member());

    // Admins cannot handle data requests, so they cannot hand that out either.
    const response = await request(app)
      .patch('/api/admin/staff/user_target')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ permissions: ['data_request.handle'] });

    expect(response.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('stops anyone changing their own role or access', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue(member({ id: 'user_actor', role: 'SUPER_ADMIN' }));

    const response = await request(app)
      .patch('/api/admin/staff/user_actor')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ status: 'SUSPENDED' });

    expect(response.status).toBe(422);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('never leaves the shop without an active super admin', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue(member({ role: 'SUPER_ADMIN' }));
    prismaMock.user.count.mockResolvedValue(0);

    const response = await request(app)
      .patch('/api/admin/staff/user_target')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ role: 'ADMIN' });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('only active super admin');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('records a role change as a role change', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue(member());
    prismaMock.user.update.mockResolvedValue(member({ role: 'ADMIN' }));

    const response = await request(app)
      .patch('/api/admin/staff/user_target')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ role: 'ADMIN' });

    expect(response.status).toBe(200);
    const { data } = prismaMock.auditLog.create.mock.calls[0][0];
    expect(data.action).toBe('staff.role_change');
    expect(data.summary).toBe('Changed sana@momishop.pk from staff to admin');
  });
});

describe('resetting a password', () => {
  it('sets a new hash and lifts a lockout', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user_target',
      email: 'sana@momishop.pk',
      role: 'STAFF',
    });

    const response = await request(app)
      .post('/api/admin/staff/user_target/password')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ password: 'new-start-2026' });

    expect(response.status).toBe(200);
    expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({
      passwordHash: 'hashed:new-start-2026',
      failedLoginCount: 0,
      lockedUntil: null,
    });
  });

  it('is not how you change your own password', async () => {
    const cookie = await signedInAs('SUPER_ADMIN');
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user_actor',
      email: 'actor@momishop.pk',
      role: 'SUPER_ADMIN',
    });

    const response = await request(app)
      .post('/api/admin/staff/user_actor/password')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ password: 'new-start-2026' });

    expect(response.status).toBe(422);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
