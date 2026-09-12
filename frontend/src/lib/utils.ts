import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Frontend utilities.
 *
 * `cn` stays in the app because it depends on Tailwind tooling that has no
 * place in the shared package the backend also imports. Every other helper is
 * pure and now lives in `@momishop/shared/text`; it is re-exported here so
 * existing `@/lib/utils` imports keep working until the app moves into
 * frontend/.
 */

/** Tailwind-aware className merge used by every UI primitive. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export * from '@momishop/shared/text';
