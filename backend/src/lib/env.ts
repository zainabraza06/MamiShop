import { z } from 'zod';

/**
 * Environment contract for the API.
 *
 * Validated lazily and cached. Importing a module that reads configuration
 * never throws, which keeps tests free of env boilerplate, while
 * `src/server.ts` calls `env()` before listening, so a misconfigured deploy
 * fails at boot rather than on its first order.
 */

const optional = z.string().optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

  /** Public storefront URL: links in emails, and where sign-in redirects land. */
  APP_URL: z.string().url().default('http://localhost:3000'),
  /**
   * Public base URL of this API, used to build the Google OAuth callback.
   * Defaults to APP_URL, because the storefront proxies /api/* to this service.
   */
  API_PUBLIC_URL: z.string().url().optional(),
  /** Extra browser origins allowed to call the API directly, comma-separated. */
  CORS_ORIGINS: z.string().default(''),
  /**
   * Express `trust proxy`. The default trusts X-Forwarded-For only from a proxy
   * on the same host, such as the storefront in front of this API. Behind a
   * load balancer, set the number of proxy hops instead.
   */
  TRUST_PROXY: z.string().default('loopback'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: optional,

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_GOOGLE_ID: optional,
  AUTH_GOOGLE_SECRET: optional,

  UPSTASH_REDIS_REST_URL: z.string().url().optional().or(z.literal('')),
  UPSTASH_REDIS_REST_TOKEN: optional,

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  JAZZCASH_MERCHANT_ID: optional,
  JAZZCASH_PASSWORD: optional,
  JAZZCASH_INTEGRITY_SALT: optional,
  JAZZCASH_RETURN_URL: optional,
  JAZZCASH_ENV: z.enum(['sandbox', 'live']).default('sandbox'),

  EASYPAISA_STORE_ID: optional,
  EASYPAISA_HASH_KEY: optional,
  EASYPAISA_RETURN_URL: optional,
  EASYPAISA_ENV: z.enum(['sandbox', 'live']).default('sandbox'),

  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,

  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default('MomiShop <orders@momishop.pk>'),
  EMAIL_REPLY_TO: optional,

  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_FROM_NUMBER: optional,

  CRON_SECRET: optional,

  SENTRY_DSN: optional,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${issues.join('\n')}`);
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Whether cookies should be marked `Secure` (and carry the `__Host-` prefix).
 *
 * Keyed to the storefront's public scheme rather than NODE_ENV, because that is
 * the thing that actually decides whether a browser will keep the cookie: a
 * Secure cookie sent over plain HTTP is dropped. It also gives both services a
 * single shared signal — reading NODE_ENV separately is how a production
 * storefront came to look for a cookie the API had issued under another name.
 */
export function secureCookies(): boolean {
  return (process.env.APP_URL ?? '').startsWith('https://');
}

function flag(name: string, storefrontName: string, fallback: boolean): boolean {
  const raw = process.env[name] ?? process.env[storefrontName];
  return raw === undefined || raw === '' ? fallback : raw === 'true';
}

/**
 * Feature flags.
 *
 * Read on each access rather than once at import, so a test can flip one.
 * `ENABLE_*` is the API's own name; the storefront's `NEXT_PUBLIC_ENABLE_*` is
 * accepted as a fallback, so one shared .env configures both services the same
 * way and they cannot disagree about whether guest checkout is on.
 */
export const flags = {
  get loyalty(): boolean {
    return flag('ENABLE_LOYALTY', 'NEXT_PUBLIC_ENABLE_LOYALTY', false);
  },
  get reviews(): boolean {
    return flag('ENABLE_REVIEWS', 'NEXT_PUBLIC_ENABLE_REVIEWS', true);
  },
  get guestCheckout(): boolean {
    return flag('ENABLE_GUEST_CHECKOUT', 'NEXT_PUBLIC_ENABLE_GUEST_CHECKOUT', true);
  },
};
