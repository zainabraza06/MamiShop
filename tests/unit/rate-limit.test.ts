import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  clientIp,
  enforceRateLimit,
  ipIdentifier,
  rateLimitHeaders,
} from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';
import { __setStoreForTesting } from '@/lib/redis';

/**
 * Rate limiting, against the in-memory store (no Redis configured in tests).
 *
 * The clock is pinned inside a window. The limiter uses fixed windows keyed by
 * floor(now / window), so an unpinned test that happened to straddle a window
 * boundary would see its counter reset and fail intermittently.
 */

beforeEach(() => {
  __setStoreForTesting(null);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T12:00:10Z'));
});

afterEach(() => {
  vi.useRealTimers();
  __setStoreForTesting(null);
});

describe('checkRateLimit', () => {
  it('allows requests up to the limit', async () => {
    // authLogin permits 5 attempts per 5 minutes.
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('authLogin', 'ip-a')).ok).toBe(true);
    }
  });

  it('blocks the request after the limit and says when to retry', async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit('authLogin', 'ip-a');
    const result = await checkRateLimit('authLogin', 'ip-a');
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each caller separately', async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit('authLogin', 'ip-a');
    expect((await checkRateLimit('authLogin', 'ip-b')).ok).toBe(true);
  });

  it('counts each policy separately', async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit('authLogin', 'ip-a');
    expect((await checkRateLimit('search', 'ip-a')).ok).toBe(true);
  });

  it('lets the caller back in once the window has passed', async () => {
    for (let i = 0; i < 6; i++) await checkRateLimit('authLogin', 'ip-a');
    vi.setSystemTime(new Date('2026-06-10T12:06:00Z'));
    expect((await checkRateLimit('authLogin', 'ip-a')).ok).toBe(true);
  });
});

describe('enforceRateLimit', () => {
  it('throws a RateLimitError once exhausted', async () => {
    for (let i = 0; i < 5; i++) await enforceRateLimit('authLogin', 'ip-a');
    await expect(enforceRateLimit('authLogin', 'ip-a')).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('clientIp', () => {
  it('takes the first address from a forwarded chain', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(clientIp(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('reports unknown when no address header is present', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });

  it('hashes the address when building an identifier', () => {
    const id = ipIdentifier(new Headers({ 'x-forwarded-for': '203.0.113.7' }));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('rateLimitHeaders', () => {
  it('omits Retry-After while the caller is within budget', () => {
    const headers = rateLimitHeaders({ ok: true, limit: 5, remaining: 3, retryAfterSeconds: 0 });
    expect(headers['X-RateLimit-Remaining']).toBe('3');
    expect(headers['Retry-After']).toBeUndefined();
  });

  it('adds Retry-After once the caller is blocked', () => {
    const headers = rateLimitHeaders({ ok: false, limit: 5, remaining: 0, retryAfterSeconds: 120 });
    expect(headers['Retry-After']).toBe('120');
  });
});
