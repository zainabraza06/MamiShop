import { withSentryConfig } from '@sentry/nextjs';

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
  "connect-src 'self' https://api.stripe.com https://*.ingest.sentry.io https://www.google-analytics.com https://*.upstash.io",
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
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', 'recharts'],
  },
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pdf-lib'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
  async redirects() {
    return [{ source: '/shop', destination: '/products', permanent: true }];
  },
};

const sentryOptions = {
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
  tunnelRoute: '/monitoring',
};

export default process.env.SENTRY_DSN ? withSentryConfig(nextConfig, sentryOptions) : nextConfig;
