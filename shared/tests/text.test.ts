import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  absoluteUrl,
  addBusinessDays,
  chunk,
  compact,
  formatOrderNumber,
  formatReturnNumber,
  normalizePhonePK,
  ratingBreakdown,
  relativeTime,
  safeRedirectPath,
  sanitizeText,
  serializable,
  slugify,
  truncate,
  uniqueSlug,
} from '../src/text';

afterEach(() => {
  vi.useRealTimers();
});

describe('slugify', () => {
  it('turns a product name into a clean URL segment', () => {
    expect(slugify('Noor — Embroidered Abaya (Ivory)')).toBe('noor-embroidered-abaya-ivory');
  });

  it('strips accents rather than dropping the letter', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('trims stray hyphens and whitespace', () => {
    expect(slugify('  --hello world--  ')).toBe('hello-world');
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when it is free', () => {
    expect(uniqueSlug('Noor Abaya', new Set())).toBe('noor-abaya');
  });

  it('appends the first free numeric suffix', () => {
    expect(uniqueSlug('Noor Abaya', new Set(['noor-abaya']))).toBe('noor-abaya-2');
    expect(uniqueSlug('Noor Abaya', new Set(['noor-abaya', 'noor-abaya-2']))).toBe('noor-abaya-3');
  });
});

describe('sanitizeText', () => {
  it('removes markup', () => {
    expect(sanitizeText('<b>Lovely</b> fabric')).toBe('Lovely fabric');
  });

  it('removes control characters that corrupt CSV and PDF output', () => {
    expect(sanitizeText('a\u0007b\u001fc')).toBe('abc');
  });

  it('keeps tabs and newlines, which are legitimate in a note', () => {
    expect(sanitizeText('line one\nline\ttwo')).toBe('line one\nline\ttwo');
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('Abaya', 10)).toBe('Abaya');
  });

  it('shortens long text with an ellipsis within the limit', () => {
    const result = truncate('Noor Nida Everyday Abaya', 10);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

describe('normalizePhonePK', () => {
  it('produces E.164 from common formats', () => {
    expect(normalizePhonePK('0300-1234567')).toBe('+923001234567');
    expect(normalizePhonePK('+92 300 1234567')).toBe('+923001234567');
    expect(normalizePhonePK('3001234567')).toBe('+923001234567');
  });

  it('returns null for anything that is not a Pakistani mobile', () => {
    expect(normalizePhonePK('12345')).toBeNull();
    expect(normalizePhonePK('0400 1234567')).toBeNull();
  });
});

describe('order and return numbers', () => {
  it('zero-pads to a fixed width', () => {
    expect(formatOrderNumber(123, 2026)).toBe('MS-2026-000123');
    expect(formatReturnNumber(5, 2026)).toBe('RMA-2026-00005');
  });
});

describe('addBusinessDays', () => {
  it('counts working days and skips Sunday', () => {
    // Monday 1 June 2026 + 6 working days lands on Monday 8 June.
    const result = addBusinessDays(new Date(2026, 5, 1), 6);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2026, 5, 8]);
  });

  it('steps over Sunday from a Saturday', () => {
    const result = addBusinessDays(new Date(2026, 5, 6), 1);
    expect(result.getDay()).toBe(1);
  });

  it('does not mutate the date it was given', () => {
    const start = new Date(2026, 5, 1);
    addBusinessDays(start, 5);
    expect(start.getDate()).toBe(1);
  });
});

describe('relativeTime', () => {
  it('describes a past date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
    const text = relativeTime(new Date('2026-06-07T12:00:00Z'));
    expect(text).toContain('3 days');
    expect(text).toContain('ago');
  });

  it('describes a future date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
    expect(relativeTime(new Date('2026-06-10T14:00:00Z'))).toContain('2 hours');
  });
});

describe('safeRedirectPath', () => {
  it('allows a same-origin relative path', () => {
    expect(safeRedirectPath('/account/orders')).toBe('/account/orders');
  });

  it('refuses an absolute URL, which would be an open redirect', () => {
    expect(safeRedirectPath('https://evil.example.com')).toBe('/');
  });

  it('refuses a protocol-relative URL, which also leaves the site', () => {
    expect(safeRedirectPath('//evil.example.com')).toBe('/');
  });

  it('falls back when nothing usable is supplied', () => {
    expect(safeRedirectPath(null, '/account')).toBe('/account');
    expect(safeRedirectPath('account', '/account')).toBe('/account');
  });
});

describe('ratingBreakdown', () => {
  it('shows a half star for a middling fraction', () => {
    expect(ratingBreakdown(4.3)).toEqual({ full: 4, half: 1, empty: 0 });
  });

  it('rounds a high fraction up to a full star', () => {
    expect(ratingBreakdown(4.8)).toEqual({ full: 5, half: 0, empty: 0 });
  });

  it('rounds a low fraction down', () => {
    expect(ratingBreakdown(4.1)).toEqual({ full: 4, half: 0, empty: 1 });
  });

  it('clamps out-of-range input', () => {
    expect(ratingBreakdown(9)).toEqual({ full: 5, half: 0, empty: 0 });
    expect(ratingBreakdown(-2)).toEqual({ full: 0, half: 0, empty: 5 });
  });

  it('always renders exactly five stars', () => {
    for (let r = 0; r <= 5; r += 0.05) {
      const { full, half, empty } = ratingBreakdown(r);
      expect(full + half + empty).toBe(5);
    }
  });
});

describe('small helpers', () => {
  it('chunks an array', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('drops null and undefined but keeps falsy values that mean something', () => {
    expect(compact({ a: 1, b: null, c: undefined, d: 0, e: '' })).toEqual({ a: 1, d: 0, e: '' });
  });

  it('serialises dates so they can cross to a client component', () => {
    const result = serializable({ at: new Date('2026-01-01T00:00:00.000Z') });
    expect(result.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('builds an absolute URL regardless of slashes', () => {
    expect(absoluteUrl('/products/x')).toBe('http://localhost:3000/products/x');
    expect(absoluteUrl('products/x')).toBe('http://localhost:3000/products/x');
  });
});
