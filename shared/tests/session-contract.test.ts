import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAMES,
  SESSION_MAX_AGE_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
  readUnverifiedClaims,
  sessionCookieName,
} from '../src/session-contract';

describe('sessionCookieName', () => {
  it('uses the __Host- prefix where cookies are served over HTTPS', () => {
    expect(sessionCookieName(true)).toBe('__Host-momishop.session');
  });

  it('drops the prefix over plain HTTP, where the browser would refuse it', () => {
    expect(sessionCookieName(false)).toBe('momishop.session');
  });

  it('lists both names for readers, most specific first', () => {
    expect(SESSION_COOKIE_NAMES).toEqual(['__Host-momishop.session', 'momishop.session']);
  });
});

describe('session lifetime', () => {
  it('refreshes a token well before it expires', () => {
    expect(SESSION_REFRESH_AFTER_SECONDS).toBeLessThan(SESSION_MAX_AGE_SECONDS);
  });
});

/**
 * The storefront proxy's view of a session.
 *
 * This deliberately does not verify the signature — see the function's comment
 * — so what matters is that it reads real claims, honours expiry, and treats
 * anything it cannot make sense of as "no session" rather than throwing.
 */
describe('readUnverifiedClaims', () => {
  const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
  const second = 1000;

  function token(payload: Record<string, unknown>): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature-not-checked`;
  }

  const valid = {
    sub: 'user_1',
    role: 'ADMIN',
    status: 'ACTIVE',
    permissions: ['order.read'],
    iat: NOW / second - 60,
    exp: NOW / second + 3600,
  };

  it('reads the claims a redirect decision needs', () => {
    expect(readUnverifiedClaims(token(valid), NOW)).toEqual(valid);
  });

  it('treats an expired token as no session', () => {
    const expired = { ...valid, exp: NOW / second - 1 };
    expect(readUnverifiedClaims(token(expired), NOW)).toBeNull();
  });

  it('rejects claims of the wrong shape rather than half-reading them', () => {
    expect(readUnverifiedClaims(token({ ...valid, sub: 42 }), NOW)).toBeNull();
    expect(readUnverifiedClaims(token({ ...valid, exp: 'soon' }), NOW)).toBeNull();
    expect(readUnverifiedClaims(token({ ...valid, role: null }), NOW)).toBeNull();
  });

  it('defaults malformed permissions to none rather than failing', () => {
    const claims = readUnverifiedClaims(token({ ...valid, permissions: 'all' }), NOW);
    expect(claims?.permissions).toEqual([]);
  });

  it('never throws on rubbish', () => {
    for (const rubbish of ['', 'not-a-token', 'a.b', 'a.b.c', 'a.!!!.c', '..']) {
      expect(readUnverifiedClaims(rubbish, NOW)).toBeNull();
    }
  });
});
