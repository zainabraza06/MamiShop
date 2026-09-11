import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { authenticate } from './auth/middleware';
import { errorHandler, notFoundHandler } from './http/error-handler';
import { noStore, originGuard } from './http/security';
import { apiRouter } from './routes';

export interface AppOptions {
  /** Public storefront URL; its origin is always allowed to make state-changing calls. */
  appUrl?: string;
  /** Additional browser origins allowed to call the API directly. */
  corsOrigins?: string[];
  /** Express `trust proxy` setting, as written in TRUST_PROXY. */
  trustProxy?: string;
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^[0-9]+$/.test(value) ? Number(value) : value;
}

/**
 * Builds the Express app without starting a server, so tests can drive it
 * through supertest.
 */
export function createApp(options: AppOptions = {}): Express {
  const appUrl = options.appUrl ?? process.env.APP_URL ?? 'http://localhost:3000';
  const corsOrigins = (options.corsOrigins ?? (process.env.CORS_ORIGINS ?? '').split(','))
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);

  const app = express();

  app.disable('x-powered-by');
  app.set(
    'trust proxy',
    parseTrustProxy(options.trustProxy ?? process.env.TRUST_PROXY ?? 'loopback'),
  );

  app.use(helmet());

  // Only needed when a browser calls the API on its own origin. The storefront
  // proxies /api/* through its own origin, which needs no CORS at all.
  if (corsOrigins.length > 0) {
    app.use('/api', cors({ origin: corsOrigins, credentials: true }));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(
    '/api',
    noStore,
    originGuard([new URL(appUrl).origin, ...corsOrigins]),
    authenticate,
    apiRouter,
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
