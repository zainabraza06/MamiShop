/**
 * Prisma error classification.
 *
 * Pure predicates over the error shape, kept out of `src/server/**` so they can
 * be unit tested without a database. Getting these wrong is quiet and
 * expensive: a retry predicate that matches too broadly will replay a genuine
 * business failure, and one that matches too narrowly silently stops retrying.
 */

/** Prisma's unique-constraint violation. */
export const UNIQUE_VIOLATION = 'P2002';

/** Prisma's record-not-found error, raised by `update`/`delete` on a missing row. */
export const RECORD_NOT_FOUND = 'P2025';

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Fields named by a P2002's `meta.target`.
 *
 * Prisma reports this as a string array on PostgreSQL, but as a single string
 * on some connectors and in some versions, so both are handled rather than
 * assuming the array.
 */
export function uniqueViolationFields(error: unknown): string[] {
  if (errorCode(error) !== UNIQUE_VIOLATION) return [];

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
}

export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (errorCode(error) !== UNIQUE_VIOLATION) return false;
  if (!field) return true;

  // Substring rather than equality: Postgres reports the constraint name
  // ("orders_orderNumber_key"), not always the bare field name.
  return uniqueViolationFields(error).some((candidate) => candidate.includes(field));
}

export function isRecordNotFound(error: unknown): boolean {
  return errorCode(error) === RECORD_NOT_FOUND;
}
