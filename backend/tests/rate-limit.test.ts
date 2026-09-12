import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  enforceRateLimit,
  rateLimitHeaders,
  releaseRateLimit,
} from '../src/lib/rate-limit';
import { RateLimitError } from '../src/lib/errors';
import { __setStoreForTesting } from '../src/lib/redis';

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

describe('releaseRateLimit', () => {
  it('hands a unit back, so five people behind one NAT can all sign in', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('authLogin', 'ip-office')).ok).toBe(true);
      await releaseRateLimit('authLogin', 'ip-office');
    }

    expect((await checkRateLimit('authLogin', 'ip-office')).ok).toBe(true);
  });

  it('refunds one unit and no more, so a known password buys no fresh budget', async () => {
    for (let i = 0; i < 4; i++) await checkRateLimit('authLogin', 'ip-attacker');

    // One success in the middle of a run of guesses.
    await checkRateLimit('authLogin', 'ip-attacker');
    await releaseRateLimit('authLogin', 'ip-attacker');

    expect((await checkRateLimit('authLogin', 'ip-attacker')).ok).toBe(true);
    expect((await checkRateLimit('authLogin', 'ip-attacker')).ok).toBe(false);
  });

  it('does nothing when the caller has spent nothing', async () => {
    await releaseRateLimit('authLogin', 'ip-quiet');
    expect((await checkRateLimit('authLogin', 'ip-quiet')).remaining).toBe(4);
  });
});

describe('enforceRateLimit', () => {
  it('throws a RateLimitError once exhausted', async () => {
    for (let i = 0; i < 5; i++) await enforceRateLimit('authLogin', 'ip-a');
    await expect(enforceRateLimit('authLogin', 'ip-a')).rejects.toBeInstanceOf(RateLimitError);
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
