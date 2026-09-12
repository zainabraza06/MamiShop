import { z } from 'zod';

/**
 * Storefront environment.
 *
 * Only public configuration is validated here. The storefront holds two
 * server-side values of its own — where the API is (API_URL) and the secret
 * its proxy verifies session tokens with (AUTH_SECRET) — and every other
 * secret, from the database to payment keys, belongs to the API and never
 * reaches this workspace.
 *
 * Next only inlines `NEXT_PUBLIC_*` values into the browser bundle, and only
 * when they are referenced by their full literal names, which is why they are
 * listed out below rather than read from a spread of process.env.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().default('MomiShop'),
  NEXT_PUBLIC_DEFAULT_CURRENCY: z.string().default('PKR'),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.string().default('en-PK'),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
  NEXT_PUBLIC_META_PIXEL_ID: z.string().optional(),
  NEXT_PUBLIC_ENABLE_LOYALTY: z.string().default('false'),
  NEXT_PUBLIC_ENABLE_REVIEWS: z.string().default('true'),
  NEXT_PUBLIC_ENABLE_GUEST_CHECKOUT: z.string().default('true'),
});

const rawClient = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_DEFAULT_CURRENCY: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID,
  NEXT_PUBLIC_ENABLE_LOYALTY: process.env.NEXT_PUBLIC_ENABLE_LOYALTY,
  NEXT_PUBLIC_ENABLE_REVIEWS: process.env.NEXT_PUBLIC_ENABLE_REVIEWS,
  NEXT_PUBLIC_ENABLE_GUEST_CHECKOUT: process.env.NEXT_PUBLIC_ENABLE_GUEST_CHECKOUT,
};

const parsed = clientSchema.safeParse(rawClient);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid public environment variables:\n${issues.join('\n')}`);
}

export const clientEnv = parsed.data;

/** Base URL the storefront's server uses to reach the API. Never sent to browsers. */
export function apiBaseUrl(): string {
  return (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}
