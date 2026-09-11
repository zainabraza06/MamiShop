import { describe, expect, it } from 'vitest';
import {
  bucketVariant,
  hashIp,
  hmacSha256Hex,
  randomCode,
  randomToken,
  safeEqual,
  sha256Hex,
} from '@/lib/crypto';

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('cron-secret', 'cron-secret')).toBe(true);
    expect(safeEqual('', '')).toBe(true);
  });

  it('rejects a single differing character', () => {
    expect(safeEqual('cron-secret', 'cron-secreT')).toBe(false);
  });

  it('rejects a different length without throwing', () => {
    // timingSafeEqual throws on unequal lengths; the wrapper must not.
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('hash functions', () => {
  it('produces the standard SHA-256 test vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces the standard HMAC-SHA256 test vector', () => {
    // Gateway callbacks (JazzCash, Easypaisa) are verified with this.
    expect(hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });
});

describe('hashIp', () => {
  it('never stores the raw address', () => {
    const hashed = hashIp('203.0.113.7');
    expect(hashed).not.toContain('203');
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same address and distinct for different ones', () => {
    expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
    expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
  });

  it('reports a missing address as unknown', () => {
    expect(hashIp(null)).toBe('unknown');
    expect(hashIp('')).toBe('unknown');
  });
});

describe('randomToken', () => {
  it('is URL-safe, so it can go straight into a link or cookie', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('encodes the requested number of bytes', () => {
    expect(randomToken(32)).toHaveLength(43);
    expect(randomToken(16)).toHaveLength(22);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('randomCode', () => {
  it('has the requested length', () => {
    expect(randomCode(8)).toHaveLength(8);
  });

  it('never uses characters that are misread over the phone', () => {
    const sample = Array.from({ length: 500 }, () => randomCode(12)).join('');
    expect(sample).not.toMatch(/[01ILO]/);
    expect(sample).toMatch(/^[A-Z2-9]+$/);
  });
});

describe('bucketVariant', () => {
  it('always puts the same visitor in the same bucket', () => {
    const first = bucketVariant('visitor-42', 'hero-cta', ['A', 'B']);
    for (let i = 0; i < 20; i++) {
      expect(bucketVariant('visitor-42', 'hero-cta', ['A', 'B'])).toBe(first);
    }
  });

  it('only returns a declared variant', () => {
    expect(['A', 'B', 'C']).toContain(bucketVariant('v', 'exp', ['A', 'B', 'C']));
  });

  it('falls back to the control when there are no variants', () => {
    expect(bucketVariant('v', 'exp', [])).toBe('A');
  });

  it('splits traffic roughly evenly', () => {
    let a = 0;
    for (let i = 0; i < 1000; i++) {
      if (bucketVariant(`visitor-${i}`, 'hero-cta', ['A', 'B']) === 'A') a++;
    }
    // Deterministic (hash-based), so this is not a flaky statistical test.
    expect(a).toBeGreaterThan(400);
    expect(a).toBeLessThan(600);
  });
});
