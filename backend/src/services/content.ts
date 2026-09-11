import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { CACHE_KEYS, CACHE_TTL, cached } from '../lib/cache';
import { productCardSelect } from './catalogue';

/**
 * Editorial content: the announcement bar, homepage blocks and the homepage
 * product strips.
 *
 * Cached, because this changes at editorial pace rather than per request, and
 * the storefront shell and homepage are the most-requested reads in the store.
 */

/** Blocks with no schedule, or whose schedule includes now. */
function liveBlocks(now: Date) {
  return {
    isActive: true,
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
  } satisfies Prisma.ContentBlockWhereInput;
}

export async function getAnnouncement(): Promise<string | null> {
  return cached(
    `${CACHE_KEYS.homepageContent}:announcement`,
    CACHE_TTL.homepageContent,
    async () => {
      const block = await prisma.contentBlock.findFirst({
        where: { key: 'ANNOUNCEMENT_BAR', ...liveBlocks(new Date()) },
        select: { data: true },
      });

      const data = block?.data as { text?: string } | undefined;
      return data?.text ?? null;
    },
  );
}

export async function getHomepageBlocks() {
  return cached(CACHE_KEYS.homepageContent, CACHE_TTL.homepageContent, async () =>
    prisma.contentBlock.findMany({
      where: { key: { not: 'ANNOUNCEMENT_BAR' }, ...liveBlocks(new Date()) },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, type: true, title: true, data: true },
    }),
  );
}

export async function getHomepageProducts() {
  const [featured, newArrivals] = await Promise.all([
    prisma.product.findMany({
      where: { status: 'ACTIVE', archivedAt: null, isFeatured: true },
      orderBy: [{ salesCount: 'desc' }],
      take: 8,
      select: productCardSelect,
    }),
    prisma.product.findMany({
      where: { status: 'ACTIVE', archivedAt: null, isNewArrival: true },
      orderBy: { publishedAt: 'desc' },
      take: 4,
      select: productCardSelect,
    }),
  ]);

  return { featured, newArrivals };
}
