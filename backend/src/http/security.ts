import type { RequestHandler } from 'express';
import { AuthorizationError } from '../lib/errors';

/**
 * API responses are per-caller by default. A route that is safe to cache (the
 * public product listing) overrides this header explicitly.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cross-site request forgery defence, in depth.
 *
 * Session cookies are SameSite=Lax, which already keeps them off a cross-site
 * form POST. This additionally refuses any state-changing browser request
 * whose Origin is not one this API serves.
 *
 * A request with no Origin at all is let through: server-to-server calls from
 * the storefront, schedulers and curl send none. Browsers attach Origin to
 * every cross-origin POST, so its absence means the request was not made by
 * another site's page — unless Fetch Metadata says otherwise, which is checked
 * too.
 */
export function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, _res, next) => {
    if (!STATE_CHANGING.has(req.method)) return next();

    const origin = req.get('origin');
    const crossSite = origin ? !allowed.has(origin) : req.get('sec-fetch-site') === 'cross-site';

    if (crossSite) {
      return next(new AuthorizationError('Cross-site requests are not accepted.'));
    }
    next();
  };
}
