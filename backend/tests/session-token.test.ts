import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { SESSION_AUDIENCE, SESSION_ISSUER } from '@momishop/shared/session-contract';
import {
  endSession,
  signSessionToken,
  startSession,
  verifySessionToken,
} from '../src/auth/session-token';

/**
 * Session tokens are the only thing standing between an anonymous request and
 * a signed-in one, so every way a token can be wrong must read as "no session".
 */

const principal = {
  id: 'user_123',
  role: 'CUSTOMER' as const,
  status: 'ACTIVE',
  permissions: ['order.read'],
};

const key = () => new TextEncoder().encode(process.env.AUTH_SECRET);

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('session tokens', () => {
  it('round-trips the principal', async () => {
    const claims = await verifySessionToken(await signSessionToken(principal));

    expect(claims).toMatchObject({
      sub: 'user_123',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      permissions: ['order.read'],
    });
    expect(claims!.exp - claims!.iat).toBe(7 * 24 * 60 * 60);
  });

  it('rejects a token whose signature was tampered with', async () => {
    const token = await signSessionToken(principal);
    const [header, , signature] = token.split('.');
    const forgedPayload = base64url({
      sub: 'user_123',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      permissions: [],
      iss: SESSION_ISSUER,
      aud: SESSION_AUDIENCE,
      iat: 1,
      exp: 9_999_999_999,
    });

    expect(await verifySessionToken(`${header}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await new SignJWT({ role: 'ADMIN', status: 'ACTIVE', permissions: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_123')
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-of-32-chars!'));

    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects an unsigned token that declares alg none', async () => {
    const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
      sub: 'user_123',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      permissions: [],
      iss: SESSION_ISSUER,
      aud: SESSION_AUDIENCE,
      iat: 1,
      exp: 9_999_999_999,
    })}.`;

    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects a correctly signed token issued for another audience', async () => {
    const token = await new SignJWT({ role: 'CUSTOMER', status: 'ACTIVE', permissions: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_123')
      .setIssuer(SESSION_ISSUER)
      .setAudience('momishop-oauth-state')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key());

    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects a correctly signed token with claims of the wrong shape', async () => {
    const token = await new SignJWT({ role: 'ROOT', status: 'ACTIVE', permissions: 'all' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_123')
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key());

    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const token = await signSessionToken(principal);

    vi.setSystemTime(new Date('2026-06-09T12:00:00Z'));
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifySessionToken('not-a-token')).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
  });
});

/**
 * The cookie the token travels in.
 *
 * `__Host-` implies Secure, and a browser drops a Secure cookie sent over plain
 * HTTP — so the name has to follow the deployment's scheme. Deriving it from
 * NODE_ENV instead let a production-mode storefront look for a cookie its
 * development-mode API had never issued, which signed everyone out.
 */
describe('the session cookie', () => {
  interface RecordedCookie {
    name: string;
    value: string;
    options: Record<string, unknown>;
  }

  function recordingResponse() {
    const written: RecordedCookie[] = [];
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        written.push({ name, value, options });
      },
      clearCookie(name: string, options: Record<string, unknown>) {
        written.push({ name, value: '', options });
      },
    } as unknown as Response;
    return { res, written };
  }

  const principal = { id: 'user_1', role: 'CUSTOMER' as const, status: 'ACTIVE', permissions: [] };

  afterEach(() => {
    process.env.APP_URL = 'http://localhost:3000';
  });

  it('is plainly named and not Secure when the storefront is served over HTTP', async () => {
    process.env.APP_URL = 'http://localhost:3000';
    const { res, written } = recordingResponse();

    await startSession(res, principal);

    expect(written[0].name).toBe('momishop.session');
    expect(written[0].options).toMatchObject({ secure: false, httpOnly: true, sameSite: 'lax' });
  });

  it('takes the __Host- prefix and Secure once the storefront is HTTPS', async () => {
    process.env.APP_URL = 'https://momishop.pk';
    const { res, written } = recordingResponse();

    await startSession(res, principal);

    expect(written[0].name).toBe('__Host-momishop.session');
    expect(written[0].options).toMatchObject({ secure: true, path: '/' });
  });

  it('clears both names on sign-out, so one issued under the other cannot linger', () => {
    const { res, written } = recordingResponse();

    endSession(res);

    expect(written.map((c) => c.name)).toEqual(['__Host-momishop.session', 'momishop.session']);
  });
});
