import { z } from 'zod';

/**
 * Boot-time environment validation.
 *
 * Two separate schemas keep the client/server boundary honest: `serverSchema`
 * may reference secrets, `clientSchema` may not. Next.js only inlines
 * `NEXT_PUBLIC_*` into the browser bundle, and because we never read
 * `process.env` for secrets outside this module, a secret cannot leak into
 * client code by accident.
 *
 * In production a missing required secret throws at boot — we would rather
 * fail the deploy than serve a half-configured store.
 */

const nonEmpty = z.string().min(1);

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: nonEmpty,
  DIRECT_URL: z.string().optional(),

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_URL: z.string().url().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  UPSTASH_REDIS_REST_URL: z.string().url().optional().or(z.literal('')),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  JAZZCASH_MERCHANT_ID: z.string().optional(),
  JAZZCASH_PASSWORD: z.string().optional(),
  JAZZCASH_INTEGRITY_SALT: z.string().optional(),
  JAZZCASH_RETURN_URL: z.string().optional(),
  JAZZCASH_ENV: z.enum(['sandbox', 'live']).default('sandbox'),

  EASYPAISA_STORE_ID: z.string().optional(),
  EASYPAISA_HASH_KEY: z.string().optional(),
  EASYPAISA_RETURN_URL: z.string().optional(),
  EASYPAISA_ENV: z.enum(['sandbox', 'live']).default('sandbox'),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('MomiShop <orders@momishop.pk>'),
  EMAIL_REPLY_TO: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  CRON_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

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

/**
 * Referenced by their full literal names so Next.js can statically inline them.
 * Destructuring `process.env` would break that.
 */
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

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

const clientParsed = clientSchema.safeParse(rawClient);
if (!clientParsed.success) {
  throw new Error(`Invalid public environment variables:\n${formatIssues(clientParsed.error)}`);
}

export const clientEnv = clientParsed.data;

/**
 * Server env is parsed lazily so importing a shared module from a client
 * component never touches secrets, and so build steps that legitimately lack
 * runtime secrets (e.g. `next build` in CI) do not explode.
 */
let cachedServerEnv: z.infer<typeof serverSchema> | null = null;

export function serverEnv(): z.infer<typeof serverSchema> {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() was called in the browser. This is a bug.');
  }
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${formatIssues(parsed.error)}`);
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export const flags = {
  loyalty: clientEnv.NEXT_PUBLIC_ENABLE_LOYALTY === 'true',
  reviews: clientEnv.NEXT_PUBLIC_ENABLE_REVIEWS === 'true',
  guestCheckout: clientEnv.NEXT_PUBLIC_ENABLE_GUEST_CHECKOUT === 'true',
} as const;

export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';
