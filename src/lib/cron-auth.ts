import { safeEqual } from '@/lib/crypto';
import { AuthorizationError } from '@/lib/errors';

/**
 * Authorises a scheduled invocation.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. The comparison is
 * constant-time, because a plain `===` short-circuits on the first differing
 * byte and leaks the secret through response timing to anyone who can call the
 * endpoint — which, being a public URL, is everyone.
 *
 * A missing CRON_SECRET is treated as a hard failure rather than "allow all".
 * Failing closed is the only safe default for an endpoint that mutates orders
 * and sends email.
 */
export function assertCronAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    throw new AuthorizationError('Scheduled tasks are not configured on this deployment.');
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !safeEqual(provided, secret)) {
    throw new AuthorizationError('Invalid scheduled-task credentials.');
  }
}
