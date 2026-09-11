/**
 * Password policy — deliberately length-first rather than symbol-soup.
 *
 * Long passphrases beat short complex strings, and aggressive complexity rules
 * push people toward predictable substitutions (P@ssw0rd!).
 *
 * Split out of the backend's password module so the registration form can run
 * the same check live without pulling bcrypt into the browser bundle. The form
 * previously imported this from a module that also imported bcryptjs, which
 * shipped a password-hashing library to every visitor of /register.
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
