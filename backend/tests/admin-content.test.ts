import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Editing site content.
 *
 * What matters: only people allowed to change what every visitor reads can do
 * it, a fix shows up straight away instead of after the cache expires, a
 * button cannot be pointed at a script, and a page's address never moves.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  contentBlock: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  page: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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

const hero = {
  headline: 'Cut to your measurements',
  subhead: 'Stitched to the numbers you give us.',
  ctaLabel: 'Shop the collection',
  ctaHref: '/products',
  imageUrl: '/hero.webp',
  imageAlt: 'A model in an ivory three piece',
};

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.contentBlock.upsert.mockResolvedValue({ id: 'block_1' });
});

describe('who may edit content', () => {
  it('is closed to staff, who cannot change what every visitor reads', async () => {
    const cookie = await signedInAs('STAFF');

    const response = await request(app).get('/api/admin/content').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });
});

describe('the announcement bar', () => {
  it('saves, and clears the cached copy so the change shows at once', async () => {
    const cookie = await signedInAs('ADMIN');
    const cachedKey = `${CACHE_KEYS.homepageContent}:announcement`;
    await kv().set(cachedKey, 'Old announcement', 600);

    const response = await request(app)
      .put('/api/admin/content/announcement')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ text: 'Eid orders close on the 25th', isActive: true });

    expect(response.status).toBe(200);
    expect(prismaMock.contentBlock.upsert.mock.calls[0][0].update.data).toEqual({
      text: 'Eid orders close on the 25th',
    });
    expect(await kv().get(cachedKey)).toBeNull();
  });

  it('refuses an end date before the start date', async () => {
    const cookie = await signedInAs('ADMIN');

    const response = await request(app)
      .put('/api/admin/content/announcement')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({
        text: 'Sale',
        isActive: true,
        startsAt: '2026-10-10T00:00:00+05:00',
        endsAt: '2026-10-01T23:59:59+05:00',
      });

    expect(response.status).toBe(422);
    expect(prismaMock.contentBlock.upsert).not.toHaveBeenCalled();
  });
});

describe('the homepage hero', () => {
  it('saves a hero whose button points at a page on the site', async () => {
    const cookie = await signedInAs('ADMIN');

    const response = await request(app)
      .put('/api/admin/content/hero')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(hero);

    expect(response.status).toBe(200);
    expect(prismaMock.contentBlock.upsert.mock.calls[0][0].create).toMatchObject({
      key: 'HOME_HERO',
      type: 'HERO',
    });
  });

  it('will not point the button at a script or another site by protocol trick', async () => {
    const cookie = await signedInAs('ADMIN');

    for (const ctaHref of ['javascript:alert(1)', '//evil.example', 'http://insecure.example']) {
      const response = await request(app)
        .put('/api/admin/content/hero')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({ ...hero, ctaHref });
      expect(response.status).toBe(422);
    }

    expect(prismaMock.contentBlock.upsert).not.toHaveBeenCalled();
  });

  it('insists on describing the image', async () => {
    const cookie = await signedInAs('ADMIN');

    const response = await request(app)
      .put('/api/admin/content/hero')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ ...hero, imageAlt: '' });

    expect(response.status).toBe(422);
  });
});

describe('pages', () => {
  it('explains an address that is already taken', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.page.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['slug'] },
      }),
    );

    const response = await request(app)
      .post('/api/admin/pages')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ slug: 'terms', title: 'Terms', body: 'Our terms.' });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('web address');
  });

  it('never moves a page to a new address, whatever the request says', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.page.findUnique.mockResolvedValue({
      id: 'page_1',
      slug: 'terms',
      title: 'Terms',
      body: 'Old.',
      isPublished: true,
    });

    const response = await request(app)
      .patch('/api/admin/pages/page_1')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ slug: 'somewhere-else', title: 'Terms & Conditions', body: 'New.' });

    expect(response.status).toBe(200);
    expect(prismaMock.page.update.mock.calls[0][0].data).not.toHaveProperty('slug');
  });

  it('answers not found for a page that does not exist', async () => {
    const cookie = await signedInAs('ADMIN');
    prismaMock.page.findUnique.mockResolvedValue(null);

    const response = await request(app).get('/api/admin/pages/missing').set('Cookie', cookie);

    expect(response.status).toBe(404);
  });
});
