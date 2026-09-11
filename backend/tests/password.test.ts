import { describe, expect, it } from 'vitest';
import { fakeVerify, hashPassword, verifyPassword } from '../src/lib/password';

// bcrypt at cost 12 is deliberately slow (~250ms per hash, more on CI runners).
const BCRYPT_TIMEOUT = 30_000;

describe('hashPassword and verifyPassword', () => {
  it(
    'round-trips a correct password',
    async () => {
      const hash = await hashPassword('CorrectHorse99');
      expect(hash).toMatch(/^\$2[aby]\$12\$/);
      expect(await verifyPassword('CorrectHorse99', hash)).toBe(true);
    },
    BCRYPT_TIMEOUT,
  );

  it(
    'rejects a wrong password',
    async () => {
      const hash = await hashPassword('CorrectHorse99');
      expect(await verifyPassword('correcthorse99', hash)).toBe(false);
    },
    BCRYPT_TIMEOUT,
  );

  it(
    'never stores the plaintext, and salts each hash',
    async () => {
      const first = await hashPassword('CorrectHorse99');
      const second = await hashPassword('CorrectHorse99');
      expect(first).not.toContain('CorrectHorse99');
      expect(first).not.toBe(second);
    },
    BCRYPT_TIMEOUT,
  );

  it('returns false for a malformed hash rather than throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
  });

  it(
    'runs a decoy comparison for unknown emails without throwing',
    async () => {
      // Its only job is to cost the same time as a real check.
      await expect(fakeVerify()).resolves.toBeUndefined();
    },
    BCRYPT_TIMEOUT,
  );
});
