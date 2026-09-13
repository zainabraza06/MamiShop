import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { imageRefSchema, pageSchema, safeText } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { CACHE_KEYS, invalidate } from '../lib/cache';
import { ConflictError, NotFoundError } from '../lib/errors';
import { isUniqueViolation } from '../lib/prisma-errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';

/**
 * Editorial content: the announcement bar, the homepage hero, and the policy
 * pages the footer links to.
 *
 * Every write clears the content caches, so an owner who fixes a typo in the
 * announcement sees it fixed on the next page load rather than ten minutes on.
 */
export const adminContentRouter = Router();

const ANNOUNCEMENT_KEY = 'ANNOUNCEMENT_BAR';
const HERO_KEY = 'HOME_HERO';

/** The announcement is cached under its own key, next to the homepage blocks. */
async function invalidateContent(): Promise<void> {
  await invalidate(CACHE_KEYS.homepageContent, `${CACHE_KEYS.homepageContent}:announcement`);
}

const auditContext = (req: Request) => ({
  ip: ipHash(req),
  userAgent: req.get('user-agent') ?? null,
});

/** Where a button may point: a path on this site, or a full https address. */
const linkSchema = z
  .string()
  .trim()
  .min(1, 'Where should the button go?')
  .max(300)
  .refine(
    (value) => (value.startsWith('/') && !value.startsWith('//')) || /^https:\/\//.test(value),
    'Use a path beginning with / or a full https:// address.',
  );

adminContentRouter.get('/admin/content', async (req, res) => {
  await requirePermission(req, 'content.write');

  const [blocks, pages] = await Promise.all([
    prisma.contentBlock.findMany({
      where: { key: { in: [ANNOUNCEMENT_KEY, HERO_KEY] } },
      select: {
        key: true,
        data: true,
        isActive: true,
        startsAt: true,
        endsAt: true,
        updatedAt: true,
      },
    }),
    prisma.page.findMany({
      orderBy: { title: 'asc' },
      select: { id: true, slug: true, title: true, isPublished: true, updatedAt: true },
    }),
  ]);

  const announcement = blocks.find((block) => block.key === ANNOUNCEMENT_KEY);
  const hero = blocks.find((block) => block.key === HERO_KEY);

  res.json({
    announcement: announcement
      ? {
          text: (announcement.data as { text?: string }).text ?? '',
          isActive: announcement.isActive,
          startsAt: announcement.startsAt,
          endsAt: announcement.endsAt,
          updatedAt: announcement.updatedAt,
        }
      : null,
    hero: hero
      ? {
          ...(hero.data as Record<string, unknown>),
          isActive: hero.isActive,
          updatedAt: hero.updatedAt,
        }
      : null,
    pages,
  });
});

const announcementSchema = z
  .object({
    text: safeText(160, 'Announcement').pipe(
      z.string().min(1, 'Write the announcement, or switch it off.'),
    ),
    isActive: z.boolean(),
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
  })
  .refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, {
    message: 'The end date must come after the start date.',
    path: ['endsAt'],
  });

adminContentRouter.put('/admin/content/announcement', async (req, res) => {
  const actor = await requirePermission(req, 'content.write');
  const input = parseBody(req, announcementSchema);

  const before = await prisma.contentBlock.findUnique({
    where: { key: ANNOUNCEMENT_KEY },
    select: { data: true, isActive: true, startsAt: true, endsAt: true },
  });

  const block = await prisma.contentBlock.upsert({
    where: { key: ANNOUNCEMENT_KEY },
    create: {
      key: ANNOUNCEMENT_KEY,
      type: 'RICH_TEXT',
      position: 0,
      data: { text: input.text },
      isActive: input.isActive,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
    update: {
      data: { text: input.text },
      isActive: input.isActive,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
    select: { id: true },
  });

  await invalidateContent();

  await recordAudit({
    actor: actorFrom(actor),
    action: 'content.update',
    entityType: 'ContentBlock',
    entityId: block.id,
    summary: input.isActive ? 'Updated the announcement bar' : 'Switched off the announcement bar',
    before: before
      ? {
          text: (before.data as { text?: string }).text,
          isActive: before.isActive,
          startsAt: before.startsAt,
          endsAt: before.endsAt,
        }
      : undefined,
    after: input,
    ...auditContext(req),
  });

  res.json({ ok: true });
});

const heroSchema = z
  .object({
    headline: safeText(120, 'Headline').pipe(z.string().min(2, 'Write a headline.')),
    subhead: safeText(300, 'Subheading').optional(),
    ctaLabel: safeText(40, 'Button text').pipe(z.string().min(1, 'Label the button.')),
    ctaHref: linkSchema,
    imageUrl: imageRefSchema.optional().or(z.literal('')),
    imageAlt: safeText(160, 'Image description').optional(),
    isActive: z.boolean().default(true),
  })
  .refine((value) => !value.imageUrl || Boolean(value.imageAlt), {
    message: 'Describe the image for people who cannot see it.',
    path: ['imageAlt'],
  });

adminContentRouter.put('/admin/content/hero', async (req, res) => {
  const actor = await requirePermission(req, 'content.write');
  const { isActive, ...data } = parseBody(req, heroSchema);

  const before = await prisma.contentBlock.findUnique({
    where: { key: HERO_KEY },
    select: { data: true, isActive: true },
  });

  const block = await prisma.contentBlock.upsert({
    where: { key: HERO_KEY },
    create: { key: HERO_KEY, type: 'HERO', position: 1, data, isActive },
    update: { data, isActive },
    select: { id: true },
  });

  await invalidateContent();

  await recordAudit({
    actor: actorFrom(actor),
    action: 'content.update',
    entityType: 'ContentBlock',
    entityId: block.id,
    summary: 'Updated the homepage hero',
    before: before
      ? { ...(before.data as Record<string, unknown>), isActive: before.isActive }
      : undefined,
    after: { ...data, isActive },
    ...auditContext(req),
  });

  res.json({ ok: true });
});

adminContentRouter.get('/admin/pages/:id', async (req, res) => {
  await requirePermission(req, 'content.write');

  const page = await prisma.page.findUnique({ where: { id: req.params.id } });
  if (!page) throw new NotFoundError('Page');

  res.json({ page });
});

adminContentRouter.post('/admin/pages', async (req, res) => {
  const actor = await requirePermission(req, 'content.write');
  const input = parseBody(req, pageSchema);

  try {
    const page = await prisma.page.create({ data: input, select: { id: true, slug: true } });

    await recordAudit({
      actor: actorFrom(actor),
      action: 'page.create',
      entityType: 'Page',
      entityId: page.id,
      summary: `Created the page /pages/${page.slug}`,
      after: { title: input.title, slug: input.slug, isPublished: input.isPublished },
      ...auditContext(req),
    });

    res.status(201).json({ page });
  } catch (error) {
    if (isUniqueViolation(error, 'slug')) {
      throw new ConflictError('Another page already uses that web address.');
    }
    throw error;
  }
});

/**
 * Editing a page. The web address is fixed once created: the footer, order
 * emails and customers' bookmarks all point at it.
 */
const pageUpdateSchema = pageSchema.omit({ slug: true });

adminContentRouter.patch('/admin/pages/:id', async (req, res) => {
  const actor = await requirePermission(req, 'content.write');
  const input = parseBody(req, pageUpdateSchema);

  const before = await prisma.page.findUnique({
    where: { id: req.params.id },
    select: { id: true, slug: true, title: true, body: true, isPublished: true },
  });
  if (!before) throw new NotFoundError('Page');

  await prisma.page.update({ where: { id: before.id }, data: input });

  await recordAudit({
    actor: actorFrom(actor),
    action: 'page.update',
    entityType: 'Page',
    entityId: before.id,
    summary: `Updated the page /pages/${before.slug}`,
    before: { title: before.title, body: before.body, isPublished: before.isPublished },
    after: { title: input.title, body: input.body, isPublished: input.isPublished },
    ...auditContext(req),
  });

  res.json({ ok: true });
});
