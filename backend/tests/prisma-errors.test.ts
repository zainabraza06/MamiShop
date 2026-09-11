import { describe, expect, it } from 'vitest';
import {
  isRecordNotFound,
  isUniqueViolation,
  uniqueViolationFields,
} from '../src/lib/prisma-errors';

/**
 * These predicates decide whether the checkout transaction retries.
 *
 * Matching too broadly replays a genuine business failure — an out-of-stock
 * order would be attempted four times and rejected four times. Matching too
 * narrowly silently stops retrying, and the order-number race resurfaces as an
 * error shown to a customer at the busiest moment.
 */

/** Shape of a Prisma P2002 on PostgreSQL. */
function uniqueError(target: unknown) {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target },
  });
}

describe('isUniqueViolation', () => {
  it('recognises a P2002 regardless of field when none is given', () => {
    expect(isUniqueViolation(uniqueError(['email']))).toBe(true);
  });

  it('matches the bare field name', () => {
    expect(isUniqueViolation(uniqueError(['orderNumber']), 'orderNumber')).toBe(true);
  });

  it('matches the Postgres constraint name, which is what is actually reported', () => {
    // Postgres names the constraint, not the column.
    expect(isUniqueViolation(uniqueError(['orders_orderNumber_key']), 'orderNumber')).toBe(true);
  });

  it('handles target reported as a single string rather than an array', () => {
    expect(isUniqueViolation(uniqueError('orders_orderNumber_key'), 'orderNumber')).toBe(true);
  });

  it('does not match a different unique constraint', () => {
    // Retrying a duplicate SKU or email would repeat the same rejection.
    expect(isUniqueViolation(uniqueError(['users_email_key']), 'orderNumber')).toBe(false);
    expect(isUniqueViolation(uniqueError(['sku']), 'orderNumber')).toBe(false);
  });

  it('does not match a different Prisma error code', () => {
    const notFound = Object.assign(new Error('Not found'), { code: 'P2025' });
    expect(isUniqueViolation(notFound, 'orderNumber')).toBe(false);
  });

  it('does not match an ordinary application error', () => {
    // An OutOfStockError must propagate immediately, never be retried.
    expect(isUniqueViolation(new Error('Out of stock'), 'orderNumber')).toBe(false);
  });

  it('tolerates malformed and missing errors without throwing', () => {
    for (const value of [null, undefined, 'a string', 42, {}, { code: 42 }]) {
      expect(isUniqueViolation(value, 'orderNumber')).toBe(false);
    }
  });

  it('tolerates a P2002 with no meta at all', () => {
    const bare = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    expect(isUniqueViolation(bare)).toBe(true);
    expect(isUniqueViolation(bare, 'orderNumber')).toBe(false);
  });
});

describe('uniqueViolationFields', () => {
  it('normalises an array target', () => {
    expect(uniqueViolationFields(uniqueError(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('normalises a string target', () => {
    expect(uniqueViolationFields(uniqueError('a'))).toEqual(['a']);
  });

  it('returns nothing for a non-P2002', () => {
    expect(uniqueViolationFields(new Error('nope'))).toEqual([]);
  });
});

describe('isRecordNotFound', () => {
  it('recognises P2025', () => {
    expect(isRecordNotFound(Object.assign(new Error('x'), { code: 'P2025' }))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isRecordNotFound(uniqueError(['email']))).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
  });
});
