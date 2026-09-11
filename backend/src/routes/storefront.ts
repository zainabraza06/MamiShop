import { Router } from 'express';
import { cartOwner, sessionUserId } from '../http/request';
import { countItems, getCart } from '../services/cart';
import { getCategoryTree } from '../services/catalogue';
import { getAnnouncement, getHomepageBlocks, getHomepageProducts } from '../services/content';

/**
 * Page-shaped reads for the storefront.
 *
 * Each returns everything one piece of the storefront needs in a single round
 * trip, so a page render costs one call to the API rather than four.
 */
export const storefrontRouter = Router();

/**
 * The shell around every storefront page: header, footer and announcement.
 * The category tree and announcement are cached, so the per-request cost is
 * the cart lookup.
 */
storefrontRouter.get('/storefront/shell', async (req, res) => {
  const [categories, cart, announcement] = await Promise.all([
    getCategoryTree(),
    getCart(cartOwner(req)),
    getAnnouncement(),
  ]);

  res.json({
    categories,
    cartCount: countItems(cart),
    isSignedIn: Boolean(sessionUserId(req)),
    announcement,
  });
});

/**
 * The homepage. Identical for every visitor and edited at editorial pace, so
 * a shared cache may hold it for a few minutes.
 */
storefrontRouter.get('/storefront/home', async (_req, res) => {
  const [blocks, categories, { featured, newArrivals }] = await Promise.all([
    getHomepageBlocks(),
    getCategoryTree(),
    getHomepageProducts(),
  ]);

  res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  res.json({ blocks, categories, featured, newArrivals });
});
