import { describe, expect, it } from 'vitest';
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
  sessionCookieName,
} from '../src/session-contract';

describe('sessionCookieName', () => {
  it('uses the __Host- prefix in production, so a subdomain cannot plant the cookie', () => {
    expect(sessionCookieName(true)).toBe('__Host-momishop.session');
  });

  it('drops the prefix in development, where there is no HTTPS for it to require', () => {
    expect(sessionCookieName(false)).toBe('momishop.session');
  });
});

describe('session lifetime', () => {
  it('refreshes a token well before it expires', () => {
    expect(SESSION_REFRESH_AFTER_SECONDS).toBeLessThan(SESSION_MAX_AGE_SECONDS);
  });
});
