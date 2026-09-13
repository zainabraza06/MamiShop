import { Router } from 'express';
import { z } from 'zod';
import { categorySchema, productSchema, safeText } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { isUniqueViolation } from '../lib/prisma-errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';
import { invalidateCatalogue } from '../lib/cache';
import { slugify, uniqueSlug } from '@momishop/shared/text';

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
      filterValues: { select: { optionId: true } },
    },
  });

  if (!product) throw new NotFoundError('Product');
  const { filterValues, ...rest } = product;
  res.json({ product: { ...rest, filterOptionIds: filterValues.map((value) => value.optionId) } });
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

/**
 * Checks every filter option a product is being tagged with still exists and
 * belongs to a custom filter, and returns the ids without duplicates.
 *
 * Without it a stale form (an option deleted in another tab) fails on the
 * foreign key and the save answers with a bare 500.
 */
async function assertFilterOptions(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;

  const found = await prisma.filterOption.count({
    where: { id: { in: unique }, filter: { kind: 'ATTRIBUTE' } },
  });
  if (found !== unique.length) {
    throw new ValidationError(
      'One of the shop filter options no longer exists. Reload the page and try again.',
      [{ field: 'filterOptionIds', message: 'Reload to see the current options.' }],
    );
  }
  return unique;
}

adminCatalogueRouter.post('/admin/products', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const input = parseBody(req, productSchema);

  const { variants, images, filterOptionIds, ...fields } = input;
  const optionIds = await assertFilterOptions(filterOptionIds);

  try {
    const product = await prisma.product.create({
      data: {
        ...fields,
        publishedAt: fields.status === 'ACTIVE' ? new Date() : null,
        variants: { create: variants.map(({ id: _id, ...variant }) => variant) },
        images: { create: images.map(({ id: _id, variantId: _variantId, ...image }) => image) },
        filterValues: { create: optionIds.map((optionId) => ({ optionId })) },
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

  const { variants, images, filterOptionIds, ...fields } = input;
  const optionIds = await assertFilterOptions(filterOptionIds);

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

      // Filter tags carry no references, so like images the set is replaced.
      await tx.productFilterValue.deleteMany({ where: { productId: before.id } });
      if (optionIds.length > 0) {
        await tx.productFilterValue.createMany({
          data: optionIds.map((optionId) => ({ productId: before.id, optionId })),
          skipDuplicates: true,
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

// ── Storefront filters ─────────────────────────────────────────────────────

const newFilterSchema = z.object({
  label: safeText(40, 'Name').pipe(z.string().min(1, 'Name the filter.')),
  options: z
    .array(safeText(40, 'Option').pipe(z.string().min(1)))
    .max(50)
    .default([]),
});

const updateFilterSchema = z
  .object({
    label: safeText(40, 'Name').pipe(z.string().min(1, 'Name the filter.')).optional(),
    isVisible: z.boolean().optional(),
  })
  .refine(
    (value) => value.label !== undefined || value.isVisible !== undefined,
    'Nothing to change.',
  );

const optionSchema = z.object({
  label: safeText(40, 'Option').pipe(z.string().min(1, 'Name the option.')),
});

const orderSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(50) });

/** Option labels as URL-safe slugs, suffixed when two would collide. */
function optionSlugs(labels: string[], taken: Iterable<string> = []): string[] {
  const used = new Set(taken);
  return labels.map((label) => {
    const slug = uniqueSlug(slugify(label) || 'option', used);
    used.add(slug);
    return slug;
  });
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every filter, built-in and custom, with how many products carry each option. */
adminCatalogueRouter.get('/admin/filters', async (req, res) => {
  await requirePermission(req, 'product.read');

  const [filters, counts] = await Promise.all([
    prisma.storefrontFilter.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { options: { orderBy: [{ position: 'asc' }, { label: 'asc' }] } },
    }),
    prisma.productFilterValue.groupBy({ by: ['optionId'], _count: { _all: true } }),
  ]);

  const countByOption = new Map(counts.map((row) => [row.optionId, row._count._all]));

  res.json({
    filters: filters.map((filter) => ({
      id: filter.id,
      kind: filter.kind,
      label: filter.label,
      slug: filter.slug,
      position: filter.position,
      isVisible: filter.isVisible,
      options: filter.options.map((option) => ({
        id: option.id,
        label: option.label,
        slug: option.slug,
        position: option.position,
        productCount: countByOption.get(option.id) ?? 0,
      })),
    })),
  });
});

/** A custom filter, added at the bottom of the panel. */
adminCatalogueRouter.post('/admin/filters', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const input = parseBody(req, newFilterSchema);

  const slug = slugify(input.label);
  if (!slug) {
    throw new ValidationError('Use letters or numbers in the filter name.', [
      { field: 'label', message: 'Use letters or numbers.' },
    ]);
  }

  // "Eid" and "eid" are one choice to a shopper; the first spelling wins.
  const labels = input.options.filter(
    (label, index, all) => all.findIndex((other) => sameLabel(other, label)) === index,
  );
  const slugs = optionSlugs(labels);
  const last = await prisma.storefrontFilter.aggregate({ _max: { position: true } });

  try {
    const filter = await prisma.$transaction(async (tx) => {
      const created = await tx.storefrontFilter.create({
        data: {
          kind: 'ATTRIBUTE',
          label: input.label,
          slug,
          position: (last._max.position ?? -1) + 1,
          options: {
            create: labels.map((label, position) => ({ label, slug: slugs[position], position })),
          },
        },
        select: { id: true, label: true },
      });

      await recordAudit(
        {
          actor: actorFrom(user),
          action: 'filter.create',
          entityType: 'StorefrontFilter',
          entityId: created.id,
          summary: `Created the ${created.label} filter`,
          after: { label: input.label, options: labels },
          ip: ipHash(req),
          userAgent: req.get('user-agent') ?? null,
        },
        tx,
      );

      return created;
    });

    res.status(201).json({ filter });
  } catch (error) {
    if (isUniqueViolation(error, 'slug')) {
      throw new ConflictError('There is already a filter with that name.');
    }
    throw error;
  }
});

/** The panel order: every filter id, top to bottom. */
adminCatalogueRouter.put('/admin/filters/order', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const { ids } = parseBody(req, orderSchema);

  const existing = await prisma.storefrontFilter.findMany({ select: { id: true } });
  const known = new Set(existing.map((filter) => filter.id));

  // A partial or stale list would leave two filters sharing a position.
  if (
    ids.length !== known.size ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => known.has(id))
  ) {
    throw new ConflictError('The filters changed while you were reordering. Reload and try again.');
  }

  await prisma.$transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx.storefrontFilter.update({ where: { id }, data: { position } });
    }

    await recordAudit(
      {
        actor: actorFrom(user),
        action: 'filter.reorder',
        entityType: 'StorefrontFilter',
        summary: 'Reordered the shop filters',
        after: { ids },
        ip: ipHash(req),
        userAgent: req.get('user-agent') ?? null,
      },
      tx,
    );
  });

  res.json({ ok: true });
});

/**
 * Rename a filter or show and hide it. Built-ins can be renamed and hidden;
 * the slug is left alone on rename because it is in shoppers' links.
 */
adminCatalogueRouter.patch('/admin/filters/:id', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const input = parseBody(req, updateFilterSchema);

  const before = await prisma.storefrontFilter.findUnique({
    where: { id: req.params.id },
    select: { id: true, label: true, isVisible: true },
  });
  if (!before) throw new NotFoundError('Filter');

  const after = await prisma.storefrontFilter.update({
    where: { id: before.id },
    data: input,
    select: { id: true, label: true, isVisible: true },
  });

  await recordAudit({
    actor: actorFrom(user),
    action: 'filter.update',
    entityType: 'StorefrontFilter',
    entityId: before.id,
    summary: `Updated the ${after.label} filter`,
    before,
    after,
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ filter: after });
});

/**
 * Deleting a custom filter.
 *
 * Allowed, unlike products or coupons: nothing financial points at a filter.
 * Its options and product tags go with it. Built-ins are hidden instead,
 * because the panel's colour, price, fabric and fit handling is built on them.
 */
adminCatalogueRouter.delete('/admin/filters/:id', async (req, res) => {
  const user = await requirePermission(req, 'product.write');

  const filter = await prisma.storefrontFilter.findUnique({
    where: { id: req.params.id },
    select: { id: true, kind: true, label: true },
  });
  if (!filter) throw new NotFoundError('Filter');
  if (filter.kind !== 'ATTRIBUTE') {
    throw new ConflictError(`${filter.label} is built in and cannot be deleted. Hide it instead.`);
  }

  await prisma.storefrontFilter.delete({ where: { id: filter.id } });

  await recordAudit({
    actor: actorFrom(user),
    action: 'filter.delete',
    entityType: 'StorefrontFilter',
    entityId: filter.id,
    summary: `Deleted the ${filter.label} filter`,
    before: { label: filter.label },
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ ok: true });
});

adminCatalogueRouter.post('/admin/filters/:id/options', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const { label } = parseBody(req, optionSchema);

  const filter = await prisma.storefrontFilter.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      kind: true,
      label: true,
      options: { select: { label: true, slug: true, position: true } },
    },
  });
  if (!filter) throw new NotFoundError('Filter');
  if (filter.kind !== 'ATTRIBUTE') {
    throw new ConflictError(
      `${filter.label} takes its choices from product details, so options cannot be added to it.`,
    );
  }
  if (filter.options.some((option) => sameLabel(option.label, label))) {
    throw new ConflictError(`${filter.label} already has an option called ${label}.`);
  }

  const [slug] = optionSlugs(
    [label],
    filter.options.map((option) => option.slug),
  );
  const position = filter.options.reduce((max, option) => Math.max(max, option.position), -1) + 1;

  const option = await prisma.filterOption.create({
    data: { filterId: filter.id, label, slug, position },
    select: { id: true, label: true, slug: true },
  });

  await recordAudit({
    actor: actorFrom(user),
    action: 'filter.update',
    entityType: 'StorefrontFilter',
    entityId: filter.id,
    summary: `Added ${label} to the ${filter.label} filter`,
    after: { option: label },
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.status(201).json({ option });
});

/** Rename an option. Its slug stays, so shared links keep working. */
adminCatalogueRouter.patch('/admin/filter-options/:id', async (req, res) => {
  const user = await requirePermission(req, 'product.write');
  const { label } = parseBody(req, optionSchema);

  const option = await prisma.filterOption.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      label: true,
      filter: { select: { id: true, label: true, options: { select: { id: true, label: true } } } },
    },
  });
  if (!option) throw new NotFoundError('Filter option');

  if (
    option.filter.options.some((other) => other.id !== option.id && sameLabel(other.label, label))
  ) {
    throw new ConflictError(`${option.filter.label} already has an option called ${label}.`);
  }

  await prisma.filterOption.update({ where: { id: option.id }, data: { label } });

  await recordAudit({
    actor: actorFrom(user),
    action: 'filter.update',
    entityType: 'StorefrontFilter',
    entityId: option.filter.id,
    summary: `Renamed ${option.label} to ${label} in the ${option.filter.label} filter`,
    before: { option: option.label },
    after: { option: label },
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ ok: true });
});

/** Remove an option; the products tagged with it simply lose the tag. */
adminCatalogueRouter.delete('/admin/filter-options/:id', async (req, res) => {
  const user = await requirePermission(req, 'product.write');

  const option = await prisma.filterOption.findUnique({
    where: { id: req.params.id },
    select: { id: true, label: true, filter: { select: { id: true, label: true } } },
  });
  if (!option) throw new NotFoundError('Filter option');

  await prisma.filterOption.delete({ where: { id: option.id } });

  await recordAudit({
    actor: actorFrom(user),
    action: 'filter.update',
    entityType: 'StorefrontFilter',
    entityId: option.filter.id,
    summary: `Removed ${option.label} from the ${option.filter.label} filter`,
    before: { option: option.label },
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ ok: true });
});
