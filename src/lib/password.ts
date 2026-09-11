import bcrypt from 'bcryptjs';

/**
 * Password hashing.
 *
 * bcrypt at cost 12 (~250ms on current hardware): high enough to make offline
 * cracking expensive, low enough that a login does not monopolise a serverless
 * invocation. Revisit the cost annually as hardware improves.
 *
 * Isolated in its own module so bcrypt is bundled only where passwords are
 * actually checked, not into every module that needs a small crypto helper.
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

/**
 * Password policy — deliberately length-first rather than symbol-soup.
 * Long passphrases beat short complex strings, and aggressive complexity rules
 * push people toward predictable substitutions (P@ssw0rd!).
 */
export function assessPasswordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  problems: string[];
} {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Use at least 10 characters.');
  if (!/[a-z]/.test(password)) problems.push('Include a lowercase letter.');
  if (!/[A-Z0-9]/.test(password)) problems.push('Include an uppercase letter or a number.');

  const common = ['password', '12345678', 'qwerty', 'letmein', 'momishop', 'admin123'];
  if (common.some((c) => password.toLowerCase().includes(c))) {
    problems.push('Avoid common words and predictable patterns.');
  }

  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (/[A-Z]/.test(password) && /[0-9]/.test(password)) score++;
  if (problems.length > 0) score = Math.min(score, 2);

  return { score: Math.min(score, 4) as 0 | 1 | 2 | 3 | 4, problems };
}
