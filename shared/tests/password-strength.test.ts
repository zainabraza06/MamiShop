import { describe, expect, it } from 'vitest';
import { assessPasswordStrength } from '../src/password-strength';

describe('assessPasswordStrength', () => {
  it('flags a password that is too short', () => {
    expect(assessPasswordStrength('Short1').problems).toContain('Use at least 10 characters.');
  });

  it('flags a password with no uppercase letter or number', () => {
    expect(assessPasswordStrength('correcthorsebattery').problems).toContain(
      'Include an uppercase letter or a number.',
    );
  });

  it('passes a long passphrase with no problems', () => {
    const result = assessPasswordStrength('CorrectHorse99');
    expect(result.problems).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('caps the score of a password built on a common word', () => {
    const result = assessPasswordStrength('Password123456');
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(2);
  });
});
