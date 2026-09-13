import { Router } from 'express';
import { z } from 'zod';
import type { MeasurementTemplateKey } from '@momishop/shared/measurements';
import { productFilterSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { NotFoundError } from '../lib/errors';
import { getCurrentUser } from '../auth/current-user';
import { rateLimit, sessionUserId } from '../http/request';
import { parseQuery } from '../http/validate';
import {
  getCategoryBySlug,
  getCategoryTree,
  getFilterFacets,
  getProductBySlug,
  getProductReviews,
  getRatingBreakdown,
  getRelatedProducts,
  listProducts,
} from '../services/catalogue';

export const catalogueRouter = Router();

catalogueRouter.get('/categories', async (_req, res) => {
  res.json({ categories: await getCategoryTree() });
});

catalogueRouter.get('/categories/:slug', async (req, res) => {
  const category = await getCategoryBySlug(req.params.slug);
  if (!category) throw new NotFoundError('Category');
  res.json({ category });
});

/**
 * Product listing, used by the listing page, "load more" and search.
 *
 * Rate limited under the `search` policy: this endpoint is the cheapest way to
 * enumerate the whole catalogue, so it gets a tighter budget than a page view.
 */
catalogueRouter.get('/products', async (req, res) => {
  await rateLimit(req, 'search');

  const result = await listProducts(parseQuery(req, productFilterSchema));

  // Safe to cache briefly at the edge: the response depends only on the query
  // string and contains no per-user data.
  res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.json(result);
});

const facetScopeSchema = z.object({
  category: z.string().trim().max(96).optional(),
  q: z.string().trim().max(120).optional(),
});

/**
 * The colours, fabrics and price range the filter panel offers.
 *
 * Registered before `/products/:slug`, which would otherwise read "facets" as
 * a product slug and answer 404.
 */
catalogueRouter.get('/products/facets', async (req, res) => {
  await rateLimit(req, 'api', sessionUserId(req));

  const facets = await getFilterFacets(parseQuery(req, facetScopeSchema));

  res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.json(facets);
});

/**
 * Everything the product page needs.
 *
 * Per-visitor, and so never cached: it includes the caller's saved
 * measurement profiles for this product's sizing template.
 */
catalogueRouter.get('/products/:slug', async (req, res) => {
  const product = await getProductBySlug(req.params.slug);
  if (!product) throw new NotFoundError('Product');

  // The sizing template falls back through product -> category -> a sane
  // default, so a product added without one still renders a usable form.
  const template = (product.sizingTemplate ??
    product.category.sizingTemplate ??
    'WOMENS_STITCHED') as MeasurementTemplateKey;

  const user = await getCurrentUser(req);

  const [related, reviews, ratingBreakdown, savedProfiles] = await Promise.all([
    getRelatedProducts(product.id, product.categoryId, product.basePrice),
    getProductReviews(product.id, 5),
    getRatingBreakdown(product.id),
    user
      ? prisma.measurementProfile.findMany({
          where: { userId: user.id, deletedAt: null, template },
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          select: { id: true, label: true, unit: true, values: true, isDefault: true },
        })
      : Promise.resolve([]),
  ]);

  res.json({
    product,
    template,
    related,
    reviews,
    ratingBreakdown,
    savedProfiles,
    isSignedIn: Boolean(user),
  });
});

const reviewPageSchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

/** Approved reviews, newest first, for the product page's "load more". */
catalogueRouter.get('/products/:productId/reviews', async (req, res) => {
  await rateLimit(req, 'api', sessionUserId(req));

  const { cursor, limit } = parseQuery(req, reviewPageSchema);
  res.json(await getProductReviews(req.params.productId, limit, cursor));
});
