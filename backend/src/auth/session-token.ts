import type { CookieOptions, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@momishop/shared/rbac';
import {
  SESSION_AUDIENCE,
  SESSION_ISSUER,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieName,
  type SessionClaims,
} from '@momishop/shared/session-contract';
import { isProduction } from '../lib/env';

/**
 * Session tokens.
 *
 * A JWT signed with HS256 under AUTH_SECRET, carried in an httpOnly cookie.
 * Stateless on purpose: verifying it costs no database round-trip, and every
 * storefront request checks it. The trade-off is that a token cannot be
 * revoked before it expires, which is why privileged checks re-read the live
 * user row (see current-user.ts) instead of trusting the role claim.
 *
 * The storefront proxy verifies the same token, so the issuer, audience and
 * cookie name come from @momishop/shared/session-contract.
 */

const ROLES: readonly string[] = ['CUSTOMER', 'STAFF', 'ADMIN', 'SUPER_ADMIN'];

export interface SessionPrincipal {
  id: string;
  role: UserRole;
  status: string;
  permissions: string[];
}

function signingKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters.');
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(principal: SessionPrincipal): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    role: principal.role,
    status: principal.status,
    permissions: principal.permissions,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.id)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(signingKey());
}

/**
 * The token's claims, or null when it is malformed, forged, expired, or was
 * issued for a different audience. The algorithm is pinned, so a token that
 * declares `alg: none` or an asymmetric algorithm is rejected outright.
 */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  const key = signingKey();

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    }));
  } catch {
    return null;
  }

  const { sub, role, status, permissions, iat, exp } = payload;

  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof role !== 'string' || !ROLES.includes(role)) return null;
  if (typeof status !== 'string') return null;
  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === 'string')) return null;
  if (typeof iat !== 'number' || typeof exp !== 'number') return null;

  return { sub, role: role as UserRole, status, permissions, iat, exp };
}

function cookieOptions(): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: isProduction(), path: '/' };
}

export async function startSession(res: Response, principal: SessionPrincipal): Promise<void> {
  const token = await signSessionToken(principal);
  res.cookie(sessionCookieName(isProduction()), token, {
    ...cookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  });
}

export function endSession(res: Response): void {
  res.clearCookie(sessionCookieName(isProduction()), cookieOptions());
}
