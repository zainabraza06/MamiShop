import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertCronAuthorized } from '../src/lib/cron-auth';
import { AuthorizationError } from '../src/lib/errors';

/**
 * Scheduled-task authorisation.
 *
 * The cron endpoints mutate orders and send email from a public URL, so the
 * one property that matters most is that they fail CLOSED: a missing secret
 * must refuse every call, never allow every call.
 */

const SECRET = 'test-cron-secret-value';
let original: string | undefined;

/** The Authorization header as Express hands it over: absent, or a string. */
function request(authorization?: string): string | undefined {
  return authorization;
}

beforeEach(() => {
  original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe('assertCronAuthorized', () => {
  it('accepts the correct bearer token', () => {
    expect(() => assertCronAuthorized(request(`Bearer ${SECRET}`))).not.toThrow();
  });

  it('rejects a request with no authorization header', () => {
    expect(() => assertCronAuthorized(request())).toThrow(AuthorizationError);
  });

  it('rejects the wrong token', () => {
    expect(() => assertCronAuthorized(request('Bearer wrong-secret'))).toThrow(AuthorizationError);
  });

  it('rejects the right secret under the wrong scheme', () => {
    expect(() => assertCronAuthorized(request(`Basic ${SECRET}`))).toThrow(AuthorizationError);
  });

  it('rejects a token that is only a prefix of the secret', () => {
    expect(() => assertCronAuthorized(request('Bearer test-cron'))).toThrow(AuthorizationError);
  });

  it('fails closed when no secret is configured, even for an empty token', () => {
    delete process.env.CRON_SECRET;
    // If this ever passed, an unconfigured deployment would run jobs for anyone.
    expect(() => assertCronAuthorized(request('Bearer '))).toThrow(AuthorizationError);
    expect(() => assertCronAuthorized(request())).toThrow(AuthorizationError);
  });
});
