import { safeEqual } from './crypto';
import { AuthorizationError } from './errors';

/**
 * Authorises a scheduled invocation from its Authorization header.
 *
 * Schedulers send `Authorization: Bearer <CRON_SECRET>`. The comparison is
 * constant-time, because a plain `===` short-circuits on the first differing
 * byte and leaks the secret through response timing to anyone who can call the
 * endpoint — which, being a public URL, is everyone.
 *
 * A missing CRON_SECRET is treated as a hard failure rather than "allow all".
 * Failing closed is the only safe default for an endpoint that mutates orders
 * and sends email.
 */
export function assertCronAuthorized(authorization: string | null | undefined): void {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    throw new AuthorizationError('Scheduled tasks are not configured on this deployment.');
  }

  const header = authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !safeEqual(provided, secret)) {
    throw new AuthorizationError('Invalid scheduled-task credentials.');
  }
}
