import type { RequestHandler } from 'express';
import {
  SESSION_COOKIE_NAMES,
  SESSION_REFRESH_AFTER_SECONDS,
} from '@momishop/shared/session-contract';
import { endSession, startSession, verifySessionToken } from './session-token';

/**
 * Reads the session cookie into `req.auth`.
 *
 * Never rejects a request: a missing, expired or forged token just means an
 * anonymous caller, and routes that need a user say so themselves. A token
 * that fails verification is cleared, so the browser stops sending it.
 *
 * Sessions slide. A token more than a day old is reissued with the same
 * claims, so a regular customer is not signed out mid-visit by a fixed
 * seven-day expiry. Reissuing never escalates anything: the role claim only
 * drives redirects, and privileged checks read the live row.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  req.auth = null;

  // Either name is accepted; the signature is what decides. See the contract.
  const token = SESSION_COOKIE_NAMES.map((name) => req.cookies?.[name]).find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (!token) return next();

  const claims = await verifySessionToken(token);
  if (!claims) {
    endSession(res);
    return next();
  }

  req.auth = claims;

  const ageSeconds = Math.floor(Date.now() / 1000) - claims.iat;
  if (ageSeconds > SESSION_REFRESH_AFTER_SECONDS) {
    await startSession(res, {
      id: claims.sub,
      role: claims.role,
      status: claims.status,
      permissions: claims.permissions,
    });
  }

  next();
};
