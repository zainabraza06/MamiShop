import { Router } from 'express';
import { z } from 'zod';
import { categorySchema, productSchema, safeText } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError } from '../lib/errors';
import { isUniqueViolation } from '../lib/prisma-errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';
import { invalidateCatalogue } from '../lib/cache';

/**
 * The catalogue, from the staff side.
 *
 * Writes invalidate the cached category tree and homepage, because a product
 * that is live but invisible for the next half hour looks like a bug to the
 * person who just published it.
 */
export const adminCatalogueRouter = Router();

const listSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().max(64).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

adminCatalogueRouter.get('/admin/products', async (req, res) => {
  await requirePermission(req, 'product.read');

  const filter = parseQuery(req, listSchema);

  const where = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.q
      ? {
          OR: [
            { name: { contains: filter.q, mode: 'insensitive' as const } },
            { sku: { contains: filter.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total, counts] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        sku: true,
        slug: true,
        name: true,
        status: true,
        basePrice: true,
        currency: true,
        isFeatured: true,
        salesCount: true,
        updatedAt: true,
        category: { select: { name: true } },
        images: { orderBy: { position: 'asc' }, take: 1, select: { url: true, alt: true } },
        variants: {
          select: { id: true, name: true, stockOnHand: true, lowStockAlert: true, isActive: true },
        },
      },
    }),
    prisma.product.count({ where }),
    prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;

  res.json({
    items: items.map((product) => ({
      ...product,
      image: product.images[0] ?? null,
      // The number staff scan for: how much of this is actually sellable.
      stockOnHand: product.variants.reduce((sum, v) => sum + (v.isActive ? v.stockOnHand : 0), 0),
      lowStock: product.variants.some((v) => v.isActive && v.stockOnHand <= v.lowStockAlert),
      images: undefined,
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    total,
    countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});

/** Categories, for the product form's picker and the category screen. */
adminCatalogueRouter.get('/admin/categories', async (req, res) => {
  await requirePermission(req, 'product.read');

  const categories = await prisma.category.findMany({
    where: { archivedAt: null },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      isActive: true,
      sizingTemplate: true,
      _count: { select: { products: true } },
    },
  });

  res.json({
    categories: categories.map(({ _count, ...category }) => ({
      ...category,
      productCount: _count.products,
    })),
  });
});

adminCatalogueRouter.get('/admin/products/:id', async (req, res) => {
  await requirePermission(req, 'product.read');

  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: {
      variants: { orderBy: { position: 'asc' } },
      images: { orderBy: { position: 'asc' } },
      category: { select: { id: true, name: true } },
    },
  });

  if (!product) throw new NotFoundError('Product');
  res.json({ product });
});

/** Turns a slug or SKU collision into a message pointing at the field. */
function rethrowCollision(error: unknown): never {
  if (isUniqueViolation(error, 'slug')) {
    throw new ConflictError('Another product already uses that web address.');
  }
  if (isUniqueViolation(error, 'sku')) {
    throw new ConflictError('Another product or variant already uses that SKU.');
  }
  throw error;
}

adminCatalogueRouter.post('/admin/products', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const input = parseBody(req, productSchema);

  const { variants, images, ...fields } = input;

  try {
    const product = await prisma.product.create({
      data: {
        ...fields,
        publishedAt: fields.status === 'ACTIVE' ? new Date() : null,
        variants: { create: variants.map(({ id: _id, ...variant }) => variant) },
        images: { create: images.map(({ id: _id, variantId: _variantId, ...image }) => image) },
      },
      select: { id: true, slug: true, name: true },
    });

    await recordAudit({
      actor: actorFrom(user),
      action: 'product.create',
      entityType: 'Product',
      entityId: product.id,
      summary: `Created ${product.name}`,
      after: fields,
      ip: ipHash(req),
      userAgent: req.get('user-agent') ?? null,
    });

    await invalidateCatalogue(product.slug);
    res.status(201).json({ product });
  } catch (error) {
    rethrowCollision(error);
  }
});

adminCatalogueRouter.patch('/admin/products/:id', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const input = parseBody(req, productSchema);

  const before = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: { id: true, slug: true, name: true, status: true, basePrice: true, publishedAt: true },
  });
  if (!before) throw new NotFoundError('Product');

  const { variants, images, ...fields } = input;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: before.id },
        data: {
          ...fields,
          // Publishing stamps the date once; re-saving a live product keeps it.
          publishedAt:
            fields.status === 'ACTIVE' ? (before.publishedAt ?? new Date()) : before.publishedAt,
        },
      });

      /**
       * Variants are matched by id: those with one are updated, those without
       * are created. A variant left out of the payload is **not** deleted —
       * order lines and stock ledgers point at it. Retiring one is what
       * `isActive` is for.
       */
      for (const [position, variant] of variants.entries()) {
        const { id, ...data } = variant;
        if (id) {
          await tx.productVariant.update({ where: { id }, data: { ...data, position } });
        } else {
          await tx.productVariant.create({ data: { ...data, position, productId: before.id } });
        }
      }

      // Images carry no references — order lines snapshot their URL — so the
      // set is replaced wholesale, which keeps ordering and deletion simple.
      await tx.productImage.deleteMany({ where: { productId: before.id } });
      if (images.length > 0) {
        await tx.productImage.createMany({
          data: images.map(({ id: _id, ...image }, position) => ({
            ...image,
            position,
            productId: before.id,
          })),
        });
      }

      await recordAudit(
        {
          actor: actorFrom(user),
          action: 'product.update',
          entityType: 'Product',
          entityId: before.id,
          summary: `Updated ${fields.name}`,
          before,
          after: { ...fields, variants: variants.length, images: images.length },
          ip: ipHash(req),
          userAgent: req.get('user-agent') ?? null,
        },
        tx,
      );
    });
  } catch (error) {
    rethrowCollision(error);
  }

  await invalidateCatalogue(before.slug);
  res.json({ ok: true });
});

/**
 * Archiving, not deleting.
 *
 * Historical orders reference the product, and an invoice from last year has
 * to keep rendering. `archivedAt` takes it off the storefront and leaves the
 * record intact.
 */
adminCatalogueRouter.post('/admin/products/:id/archive', async (req, res) => {
  const user = await requirePermission(req, 'product.delete');

  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, slug: true, archivedAt: true },
  });
  if (!product) throw new NotFoundError('Product');

  const archiving = product.archivedAt === null;

  await prisma.product.update({
    where: { id: product.id },
    data: {
      archivedAt: archiving ? new Date() : null,
      status: archiving ? 'ARCHIVED' : 'DRAFT',
    },
  });

  await recordAudit({
    actor: actorFrom(user),
    action: 'product.archive',
    entityType: 'Product',
    entityId: product.id,
    summary: `${archiving ? 'Archived' : 'Restored'} ${product.name}`,
    before: { archivedAt: product.archivedAt },
    after: { archivedAt: archiving ? new Date() : null },
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  await invalidateCatalogue(product.slug);
  res.json({ ok: true, archived: archiving });
});

const stockSchema = z.object({
  stockOnHand: z.coerce.number().int().min(0).max(1_000_000),
  note: safeText(200, 'Note').optional(),
});

/**
 * A stock correction — a recount, damage, a delivery.
 *
 * Set the true figure rather than a delta; the ledger records the difference,
 * because "what is on the shelf" is the thing a person can actually verify.
 */
adminCatalogueRouter.patch('/admin/variants/:id/stock', async (req, res) => {
  const user = await requirePermission(req, 'inventory.write');
  const input = parseBody(req, stockSchema);

  const variant = await prisma.productVariant.findUnique({
    where: { id: req.params.id },
    select: { id: true, sku: true, stockOnHand: true, productId: true },
  });
  if (!variant) throw new NotFoundError('Variant');

  const delta = input.stockOnHand - variant.stockOnHand;

  await prisma.$transaction(async (tx) => {
    await tx.productVariant.update({
      where: { id: variant.id },
      data: { stockOnHand: input.stockOnHand },
    });

    if (delta !== 0) {
      await tx.inventoryLedger.create({
        data: {
          variantId: variant.id,
          delta,
          reason: 'ADJUSTMENT',
          note: input.note,
          actorId: user.id,
        },
      });
    }

    await recordAudit(
      {
        actor: actorFrom(user),
        action: 'inventory.adjust',
        entityType: 'ProductVariant',
        entityId: variant.id,
        summary: `${variant.sku}: ${variant.stockOnHand} → ${input.stockOnHand}`,
        before: { stockOnHand: variant.stockOnHand },
        after: { stockOnHand: input.stockOnHand, note: input.note },
        ip: ipHash(req),
        userAgent: req.get('user-agent') ?? null,
      },
      tx,
    );
  });

  res.json({ ok: true, stockOnHand: input.stockOnHand, delta });
});

// ── Categories ─────────────────────────────────────────────────────────────

adminCatalogueRouter.post('/admin/categories', async (req, res) => {
  const user = await requirePermission(req, 'category.write');
  const input = parseBody(req, categorySchema);

  try {
    const category = await prisma.category.create({
      data: input,
      select: { id: true, name: true },
    });

    await recordAudit({
      actor: actorFrom(user),
      action: 'category.create',
      entityType: 'Category',
      entityId: category.id,
      summary: `Created ${category.name}`,
      after: input,
      ip: ipHash(req),
      userAgent: req.get('user-agent') ?? null,
    });

    await invalidateCatalogue();
    res.status(201).json({ category });
  } catch (error) {
    if (isUniqueViolation(error, 'slug')) {
      throw new ConflictError('Another category already uses that web address.');
    }
    throw error;
  }
});

adminCatalogueRouter.patch('/admin/categories/:id', async (req, res) => {
  const user = await requirePermission(req, 'category.write');
  const input = parseBody(req, categorySchema);

  const before = await prisma.category.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, slug: true, isActive: true, parentId: true },
  });
  if (!before) throw new NotFoundError('Category');

  // A category that is its own parent disappears from the tree entirely.
  if (input.parentId === before.id) {
    throw new ConflictError('A category cannot sit inside itself.');
  }

  try {
    await prisma.category.update({ where: { id: before.id }, data: input });
  } catch (error) {
    if (isUniqueViolation(error, 'slug')) {
      throw new ConflictError('Another category already uses that web address.');
    }
    throw error;
  }

  await recordAudit({
    actor: actorFrom(user),
    action: 'category.update',
    entityType: 'Category',
    entityId: before.id,
    summary: `Updated ${input.name}`,
    before,
    after: input,
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  await invalidateCatalogue();
  res.json({ ok: true });
});
