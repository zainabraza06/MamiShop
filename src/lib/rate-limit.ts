import { kv } from '@/lib/redis';
import { RateLimitError } from '@/lib/errors';
import { hashIp } from '@/lib/crypto';

/**
 * Fixed-window rate limiting.
 *
 * A fixed window can allow up to 2x the limit across a window boundary. That
 * is an acceptable trade for these endpoints: the goal is to stop credential
 * stuffing and scraping, not to meter a paid API. The implementation is a
 * single INCR, which keeps it cheap enough to run on every auth attempt.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Named policies. Tuned so a real customer never notices, while automated
 * abuse hits the wall quickly.
 */
export const RATE_LIMITS = {
  /** Sign-in: slow enough that guessing a password is impractical. */
  authLogin: { limit: 5, windowSeconds: 300 },
  authRegister: { limit: 3, windowSeconds: 3600 },
  authPasswordReset: { limit: 3, windowSeconds: 3600 },
  /** Checkout: generous for retries, tight enough to stop card testing. */
  checkout: { limit: 10, windowSeconds: 600 },
  /** Search is cheap but scrapeable. */
  search: { limit: 60, windowSeconds: 60 },
  /** Anything that sends an email or SMS on the user's behalf. */
  contact: { limit: 5, windowSeconds: 3600 },
  reviewCreate: { limit: 10, windowSeconds: 3600 },
  upload: { limit: 30, windowSeconds: 3600 },
  api: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Consumes one unit from the caller's budget.
 * `identifier` should be the most specific stable handle available — a user
 * id when signed in, otherwise a hashed IP.
 */
export async function checkRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
  const key = `rl:${name}:${identifier}:${window}`;

  const count = await kv().incr(key, rule.windowSeconds);
  const remaining = Math.max(0, rule.limit - count);
  const ok = count <= rule.limit;

  let retryAfterSeconds = 0;
  if (!ok) {
    const ttl = await kv().ttl(key);
    retryAfterSeconds = ttl > 0 ? ttl : rule.windowSeconds;
  }

  return { ok, limit: rule.limit, remaining, retryAfterSeconds };
}

/** Throwing variant for use inside route handlers and server actions. */
export async function enforceRateLimit(name: RateLimitName, identifier: string): Promise<void> {
  const result = await checkRateLimit(name, identifier);
  if (!result.ok) throw new RateLimitError(result.retryAfterSeconds);
}

/**
 * Best-effort client IP.
 *
 * Only trusted because Vercel overwrites `x-forwarded-for` at the edge. On
 * another host, terminate at a proxy you control and strip inbound values, or
 * this header is trivially spoofed.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? 'unknown';
}

/** Convenience: a hashed-IP identifier straight from a request. */
export function ipIdentifier(headers: Headers): string {
  return hashIp(clientIp(headers));
}

/** Standard headers so clients can back off politely. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
  if (!result.ok) headers['Retry-After'] = String(result.retryAfterSeconds);
  return headers;
}
