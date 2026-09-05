import { Redis } from '@upstash/redis';

/**
 * Key/value store used for rate limiting, cached category trees, and
 * short-lived checkout locks.
 *
 * Upstash's REST client is used rather than a TCP client because serverless
 * functions cannot hold a connection pool across invocations. When Upstash is
 * not configured (local dev, CI, unit tests) we fall back to a bounded
 * in-memory map so nothing has to be conditionally disabled. The fallback is
 * per-process, so it is correct for a single dev server and explicitly not
 * safe for multi-instance production — hence the boot warning.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Returns seconds until the key expires, or -1 when it has no TTL. */
  ttl(key: string): Promise<number>;
}

class UpstashStore implements KeyValueStore {
  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    return (await this.client.get<T>(key)) ?? null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.client.set(key, value, { ex: ttlSeconds });
    else await this.client.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    // Only set the expiry on the first increment, so a burst of requests
    // cannot keep pushing the window forward and defeat the limit.
    if (count === 1) await this.client.expire(key, ttlSeconds);
    return count;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, { value: unknown; expiresAt: number | null }>();
  private static readonly MAX_KEYS = 10_000;

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.map.delete(key);
    }
    // Hard cap prevents an unbounded map from becoming a memory leak in dev.
    if (this.map.size > MemoryStore.MAX_KEYS) {
      const excess = this.map.size - MemoryStore.MAX_KEYS;
      let removed = 0;
      for (const key of this.map.keys()) {
        this.map.delete(key);
        if (++removed >= excess) break;
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    this.sweep();
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.sweep();
    this.map.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    const existing = this.map.get(key);
    this.map.set(key, {
      value: next,
      expiresAt: existing?.expiresAt ?? Date.now() + ttlSeconds * 1000,
    });
    return next;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.map.get(key);
    if (!entry || entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }
}

let store: KeyValueStore | null = null;

export function kv(): KeyValueStore {
  if (store) return store;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    store = new UpstashStore(new Redis({ url, token }));
  } else {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        JSON.stringify({
          level: 'warn',
          message:
            'Redis is not configured. Falling back to per-process in-memory storage: ' +
            'rate limits and caches will NOT be shared across instances.',
        }),
      );
    }
    store = new MemoryStore();
  }
  return store;
}

/** Test hook — lets a suite inject a clean store between cases. */
export function __setStoreForTesting(next: KeyValueStore | null): void {
  store = next;
}
