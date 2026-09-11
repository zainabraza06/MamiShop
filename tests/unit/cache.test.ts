import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_KEYS, cached, invalidate, invalidateCatalogue } from '@/lib/cache';
import { __setStoreForTesting, kv, type KeyValueStore } from '@/lib/redis';

/**
 * Read-through cache.
 *
 * Correctness matters more here than hit rate: a cache that serves stale data
 * after an admin edit, or that takes the site down when Redis is unreachable,
 * is worse than no cache at all.
 */

beforeEach(() => {
  __setStoreForTesting(null);
});

afterEach(() => {
  __setStoreForTesting(null);
});

describe('cached', () => {
  it('computes once, then serves the stored value', async () => {
    const produce = vi.fn(async () => ({ categories: 5 }));

    expect(await cached('k:tree', 60, produce)).toEqual({ categories: 5 });
    expect(await cached('k:tree', 60, produce)).toEqual({ categories: 5 });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('keeps separate keys separate', async () => {
    await cached('k:a', 60, async () => 'a');
    expect(await cached('k:b', 60, async () => 'b')).toBe('b');
  });

  it('recomputes after invalidation', async () => {
    const produce = vi.fn(async () => 'fresh');
    await cached('k:x', 60, produce);
    await invalidate('k:x');
    await cached('k:x', 60, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('falls through to the origin when the store fails to read', async () => {
    const broken: KeyValueStore = {
      get: async () => {
        throw new Error('ECONNREFUSED');
      },
      set: async () => {},
      del: async () => {},
      incr: async () => 1,
      ttl: async () => -1,
    };
    __setStoreForTesting(broken);

    // A slow store beats a broken one: the page must still render.
    await expect(cached('k:y', 60, async () => 'from-origin')).resolves.toBe('from-origin');
  });

  it('still returns the value when the store fails to write', async () => {
    const readOnly: KeyValueStore = {
      get: async () => null,
      set: async () => {
        throw new Error('READONLY');
      },
      del: async () => {},
      incr: async () => 1,
      ttl: async () => -1,
    };
    __setStoreForTesting(readOnly);

    await expect(cached('k:z', 60, async () => 'value')).resolves.toBe('value');
  });

  it('does not throw when invalidation fails', async () => {
    const noDelete: KeyValueStore = {
      get: async () => null,
      set: async () => {},
      del: async () => {
        throw new Error('down');
      },
      incr: async () => 1,
      ttl: async () => -1,
    };
    __setStoreForTesting(noDelete);

    await expect(invalidate('k:a', 'k:b')).resolves.toBeUndefined();
  });
});

describe('invalidateCatalogue', () => {
  it('clears the category tree, homepage and the edited product', async () => {
    await kv().set(CACHE_KEYS.categoryTree, 'tree');
    await kv().set(CACHE_KEYS.homepageContent, 'home');
    await kv().set(CACHE_KEYS.product('noor-abaya'), 'product');
    await kv().set(CACHE_KEYS.product('other'), 'untouched');

    await invalidateCatalogue('noor-abaya');

    expect(await kv().get(CACHE_KEYS.categoryTree)).toBeNull();
    expect(await kv().get(CACHE_KEYS.homepageContent)).toBeNull();
    expect(await kv().get(CACHE_KEYS.product('noor-abaya'))).toBeNull();
    // Only the product that changed is evicted.
    expect(await kv().get(CACHE_KEYS.product('other'))).toBe('untouched');
  });

  it('clears the shared keys when no product is named', async () => {
    await kv().set(CACHE_KEYS.categoryTree, 'tree');
    await invalidateCatalogue();
    expect(await kv().get(CACHE_KEYS.categoryTree)).toBeNull();
  });
});
