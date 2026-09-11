import bcrypt from 'bcryptjs';

/**
 * Password hashing.
 *
 * bcrypt at cost 12 (~250ms on current hardware): high enough to make offline
 * cracking expensive, low enough that a login does not monopolise a serverless
 * invocation. Revisit the cost annually as hardware improves.
 *
 * Server-only. The strength check that the registration form runs live lives in
 * `@momishop/shared/password-strength` precisely so that importing it cannot
 * drag bcrypt into a browser bundle — which is what happened when both lived in
 * this file.
 */
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * A bcrypt comparison against a throwaway hash.
 *
 * Called when the submitted email has no account, so that "unknown email" and
 * "wrong password" cost the same wall-clock time. Without it, response timing
 * enumerates which email addresses are registered.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1FbUCRl1M9U0kNHMwLc7Qh7T8y7cRxa';

export async function fakeVerify(): Promise<void> {
  await bcrypt.compare('dummy-password-for-timing', DUMMY_HASH);
}

export { assessPasswordStrength } from '@momishop/shared/password-strength';
