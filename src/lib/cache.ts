import { kv } from '@/lib/redis';
import { logger } from '@/lib/logger';

/**
 * Read-through cache for expensive, rarely-changing reads: the category tree,
 * homepage content blocks, shipping/tax rules.
 *
 * Cache failures are never fatal. If Redis is unreachable we log and fall
 * through to the origin query — a slow store beats a broken one.
 */

export const CACHE_TTL = {
  categoryTree: 60 * 30,
  homepageContent: 60 * 10,
  shippingRules: 60 * 30,
  taxRules: 60 * 60,
  settings: 60 * 5,
  productCard: 60 * 5,
} as const;

export const CACHE_KEYS = {
  categoryTree: 'cache:category-tree:v1',
  homepageContent: 'cache:homepage:v1',
  shippingRules: 'cache:shipping-rules:v1',
  taxRules: 'cache:tax-rules:v1',
  settings: 'cache:settings:v1',
  product: (slug: string) => `cache:product:v1:${slug}`,
} as const;

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await kv().get<T>(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch (error) {
    logger.warn('Cache read failed, falling through to origin', { key, error });
  }

  const value = await produce();

  try {
    await kv().set(key, value, ttlSeconds);
  } catch (error) {
    logger.warn('Cache write failed', { key, error });
  }

  return value;
}

export async function invalidate(...keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await kv().del(key);
      } catch (error) {
        logger.warn('Cache invalidation failed', { key, error });
      }
    }),
  );
}

/**
 * Called after any catalogue write. Deliberately coarse: correctness matters
 * more than cache hit rate, and these keys are cheap to rebuild.
 */
export async function invalidateCatalogue(productSlug?: string): Promise<void> {
  const keys: string[] = [CACHE_KEYS.categoryTree, CACHE_KEYS.homepageContent];
  if (productSlug) keys.push(CACHE_KEYS.product(productSlug));
  await invalidate(...keys);
}
