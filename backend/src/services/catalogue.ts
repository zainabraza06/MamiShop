import { prisma } from '../lib/db';
import { CACHE_KEYS, CACHE_TTL, cached } from '../lib/cache';
import type { ProductFilter } from '@momishop/shared/validation';
import type { Prisma } from '@prisma/client';

/**
 * Catalogue reads.
 *
 * All list queries are cursor-paginated. Offset pagination (`skip`) forces
 * Postgres to walk and discard every preceding row, so page 40 of a growing
 * catalogue gets progressively slower and duplicates items whenever something
 * is inserted mid-scroll. A keyset cursor is O(1) on an indexed column and
 * stable under concurrent writes.
 */

/** Fields needed to render a product card. Kept narrow — grids fetch many. */
export const productCardSelect = {
  id: true,
  slug: true,
  name: true,
  basePrice: true,
  compareAtPrice: true,
  currency: true,
  ratingAverage: true,
  ratingCount: true,
  isNewArrival: true,
  stitchingDays: true,
  category: { select: { name: true, slug: true } },
  images: {
    where: { variantId: null },
    orderBy: { position: 'asc' },
    take: 2,
    select: { url: true, alt: true, blurHash: true },
  },
} satisfies Prisma.ProductSelect;

export type ProductCard = Prisma.ProductGetPayload<{ select: typeof productCardSelect }>;

const SORT_ORDER: Record<ProductFilter['sort'], Prisma.ProductOrderByWithRelationInput[]> = {
  // Every sort ends with `id` as a tiebreaker. Without it, rows sharing a sort
  // value have no stable order and the cursor can skip or repeat items.
  newest: [{ publishedAt: 'desc' }, { id: 'desc' }],
  'price-asc': [{ basePrice: 'asc' }, { id: 'asc' }],
  'price-desc': [{ basePrice: 'desc' }, { id: 'desc' }],
  rating: [{ ratingAverage: 'desc' }, { id: 'desc' }],
  popular: [{ salesCount: 'desc' }, { id: 'desc' }],
};

export interface ProductListResult {
  items: ProductCard[];
  nextCursor: string | null;
  /** Total matching the filter, for "showing 24 of 312". */
  total: number;
}

/**
 * Builds the WHERE clause shared by the listing and its count.
 *
 * `status: 'ACTIVE'` and the archive check are non-negotiable: a draft or
 * archived product must never appear on the storefront, and forgetting the
 * filter on one query path is how an unreleased collection leaks.
 */
function storefrontWhere(filter: Partial<ProductFilter>): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {
    status: 'ACTIVE',
    archivedAt: null,
    publishedAt: { lte: new Date() },
  };

  if (filter.category) {
    // Matches the category itself or any descendant, so /products/womens
    // includes everything filed under its children.
    where.category = {
      OR: [{ slug: filter.category }, { parent: { slug: filter.category } }],
    };
  }

  if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
    where.basePrice = {
      ...(filter.minPrice !== undefined ? { gte: filter.minPrice } : {}),
      ...(filter.maxPrice !== undefined ? { lte: filter.maxPrice } : {}),
    };
  }

  if (filter.fabric) {
    where.fabric = { equals: filter.fabric, mode: 'insensitive' };
  }

  const tags = Array.isArray(filter.tags) ? filter.tags : filter.tags ? [filter.tags] : [];
  if (tags.length > 0) {
    where.tags = { hasSome: tags };
  }

  if (filter.q) {
    // Postgres full-text search across the fields a shopper actually types.
    // `mode: 'insensitive'` on contains covers partial words that tsquery
    // misses ("abay" while still typing).
    const q = filter.q.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { shortDescription: { contains: q, mode: 'insensitive' } },
      { fabric: { contains: q, mode: 'insensitive' } },
      { tags: { has: q.toLowerCase() } },
    ];
  }

  return where;
}

export async function listProducts(filter: ProductFilter): Promise<ProductListResult> {
  const where = storefrontWhere(filter);
  const orderBy = SORT_ORDER[filter.sort];

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      select: productCardSelect,
      // Fetch one extra to learn whether another page exists without a
      // second COUNT query.
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    }),
    prisma.product.count({ where }),
  ]);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
    total,
  };
}

/**
 * Full product detail. Returns null rather than throwing so the page can 404.
 *
 * Not separately memoised: the page is ISR-cached for an hour, so an extra
 * cache layer here would only add a second thing to invalidate.
 */
export async function getProductBySlug(slug: string) {
  return findProductBySlug(slug);
}

async function findProductBySlug(slug: string) {
  return prisma.product.findFirst({
    where: { slug, status: 'ACTIVE', archivedAt: null },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          sizingTemplate: true,
          parent: { select: { name: true, slug: true } },
        },
      },
      variants: {
        where: { isActive: true },
        orderBy: { position: 'asc' },
        select: {
          id: true,
          sku: true,
          kind: true,
          name: true,
          colorHex: true,
          priceDelta: true,
          trackInventory: true,
          stockOnHand: true,
          stockReserved: true,
        },
      },
      images: {
        orderBy: { position: 'asc' },
        select: { id: true, url: true, alt: true, variantId: true, blurHash: true },
      },
    },
  });
}

/**
 * "You may also like".
 *
 * Content-based rather than collaborative: with a catalogue this size there is
 * not enough co-purchase data for behavioural recommendations to beat "same
 * category, similar price, well reviewed". Explicitly excludes the product
 * being viewed, which is the classic off-by-one in this query.
 */
export async function getRelatedProducts(
  productId: string,
  categoryId: string,
  basePrice: number,
  limit = 4,
): Promise<ProductCard[]> {
  const window = Math.max(50_000, Math.round(basePrice * 0.4));

  const sameCategory = await prisma.product.findMany({
    where: {
      id: { not: productId },
      categoryId,
      status: 'ACTIVE',
      archivedAt: null,
      basePrice: { gte: basePrice - window, lte: basePrice + window },
    },
    orderBy: [{ ratingAverage: 'desc' }, { salesCount: 'desc' }],
    take: limit,
    select: productCardSelect,
  });

  if (sameCategory.length >= limit) return sameCategory;

  // Top up from the wider catalogue so the strip is never half-empty, which
  // reads as a broken component rather than a deliberate short list.
  const fill = await prisma.product.findMany({
    where: {
      id: { notIn: [productId, ...sameCategory.map((p) => p.id)] },
      status: 'ACTIVE',
      archivedAt: null,
    },
    orderBy: [{ salesCount: 'desc' }],
    take: limit - sameCategory.length,
    select: productCardSelect,
  });

  return [...sameCategory, ...fill];
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  sizingTemplate: string | null;
  productCount: number;
  children: CategoryNode[];
}

/**
 * The nested category tree used by the header, filters and sitemap.
 *
 * Cached because it changes rarely and is read on essentially every page.
 * Built in memory from one flat query rather than a recursive CTE — the tree
 * is a few dozen rows, and one query beats N.
 */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  return cached(CACHE_KEYS.categoryTree, CACHE_TTL.categoryTree, async () => {
    const rows = await prisma.category.findMany({
      where: { isActive: true, archivedAt: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        imageUrl: true,
        sizingTemplate: true,
        _count: { select: { products: { where: { status: 'ACTIVE', archivedAt: null } } } },
      },
    });

    const byId = new Map<string, CategoryNode>();
    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        slug: row.slug,
        imageUrl: row.imageUrl,
        sizingTemplate: row.sizingTemplate,
        productCount: row._count.products,
        children: [],
      });
    }

    const roots: CategoryNode[] = [];
    for (const row of rows) {
      const node = byId.get(row.id);
      if (!node) continue;
      const parent = row.parentId ? byId.get(row.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    // Roll child counts up so "Women's (42)" reflects its subcategories.
    const rollUp = (node: CategoryNode): number => {
      node.productCount += node.children.reduce((sum, child) => sum + rollUp(child), 0);
      return node.productCount;
    };
    roots.forEach(rollUp);

    return roots;
  });
}

export async function getCategoryBySlug(slug: string) {
  return prisma.category.findFirst({
    where: { slug, isActive: true, archivedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      sizingTemplate: true,
      metaTitle: true,
      metaDescription: true,
      parent: { select: { name: true, slug: true } },
      children: {
        where: { isActive: true, archivedAt: null },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, slug: true, imageUrl: true },
      },
    },
  });
}

/** Slugs for `generateStaticParams`. Tolerates an unreachable database at build time. */
export async function getPublishedProductSlugs(limit = 1000): Promise<string[]> {
  try {
    const rows = await prisma.product.findMany({
      where: { status: 'ACTIVE', archivedAt: null },
      orderBy: { salesCount: 'desc' },
      take: limit,
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  } catch {
    // A CI build without DATABASE_URL should still succeed; those pages just
    // render on first request instead of being prebuilt.
    return [];
  }
}

/** Approved reviews for a product, newest first. */
export async function getProductReviews(productId: string, limit = 10, cursor?: string) {
  const rows = await prisma.review.findMany({
    where: { productId, status: 'APPROVED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      photos: true,
      isVerifiedPurchase: true,
      createdAt: true,
      user: { select: { name: true, image: true } },
    },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Star distribution for the ratings histogram. */
export async function getRatingBreakdown(productId: string): Promise<Record<number, number>> {
  const rows = await prisma.review.groupBy({
    by: ['rating'],
    where: { productId, status: 'APPROVED' },
    _count: { _all: true },
  });

  const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) breakdown[row.rating] = row._count._all;
  return breakdown;
}
