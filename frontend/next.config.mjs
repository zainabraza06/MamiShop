import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { withSentryConfig } from '@sentry/nextjs';

/**
 * Local configuration lives in the repository root's .env, shared with the
 * API. Next only reads .env files beside this config, so the root ones are
 * loaded explicitly, with the same precedence rules Next applies to its own
 * (.env.local over .env, and an already-set variable always wins).
 */
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(repositoryRoot, process.env.NODE_ENV !== 'production');

/** Where the storefront's server reaches the API. Never exposed to browsers. */
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/**
 * Content Security Policy.
 * Stripe needs frame-src + script-src; Cloudinary serves images.
 * `unsafe-inline` on styles is required by Tailwind/Next's injected styles.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' blob: data: https://res.cloudinary.com https://lh3.googleusercontent.com https://www.google-analytics.com https://www.facebook.com",
  "connect-src 'self' https://api.cloudinary.com https://api.stripe.com https://*.ingest.sentry.io https://www.google-analytics.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://sandbox.jazzcash.com.pk https://payments.jazzcash.com.pk https://easypay.easypaisa.com.pk",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 420, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  // The shared workspace package ships TypeScript source rather than a build,
  // so Next has to compile it alongside the app.
  transpilePackages: ['@momishop/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', 'recharts'],
  },
  async headers() {
    // API responses carry their own caching headers, set by the API.
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [{ source: '/shop', destination: '/products', permanent: true }];
  },
  async rewrites() {
    return [
      /**
       * The browser reaches the API through the storefront's own origin.
       * Session and cart cookies therefore stay first-party, SameSite=Lax
       * protects them without exceptions, and no CORS is involved.
       */
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
    ];
  },
};

const sentryOptions = {
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
  tunnelRoute: '/monitoring',
};

export default process.env.SENTRY_DSN ? withSentryConfig(nextConfig, sentryOptions) : nextConfig;
