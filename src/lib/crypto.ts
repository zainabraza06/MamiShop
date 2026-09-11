import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Small crypto helpers. Password hashing lives separately in
 * src/lib/password.ts, so code that only needs these helpers — signature checks,
 * token generation — does not pull bcrypt into its bundle.
 */

/**
 * Hashes an IP address before storage. We record IPs for abuse detection and
 * account lockout, but keeping them in the clear is a privacy liability. The
 * salt is the deployment's AUTH_SECRET, so hashes are stable within a
 * deployment and meaningless outside it.
 */
export function hashIp(ip: string | null | undefined): string {
  if (!ip) return 'unknown';
  const salt = process.env.AUTH_SECRET ?? 'momishop-fallback-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

/** URL-safe random token for cart cookies, unsubscribe links, etc. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Short human-friendly code (referral codes, coupon suggestions).
 * Excludes look-alike characters (0/O, 1/I/L) so codes survive being read
 * aloud over the phone or copied off a printed insert.
 */
export function randomCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

/**
 * Constant-time string comparison. Use for every secret comparison (webhook
 * signatures, cron tokens): a plain `===` short-circuits on the first
 * differing byte and leaks the secret through response timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Burn an equivalent comparison so timing does not reveal the mismatch kind.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Deterministically buckets a visitor into an A/B variant.
 * Same visitor + same experiment always lands in the same bucket, with no
 * server state, so a returning shopper never sees the layout flip.
 */
export function bucketVariant(
  visitorId: string,
  experimentKey: string,
  variants: string[],
): string {
  if (variants.length === 0) return 'A';
  const digest = createHash('sha256').update(`${experimentKey}:${visitorId}`).digest();
  return variants[digest.readUInt32BE(0) % variants.length];
}
