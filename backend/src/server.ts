import { createApp } from './app';
import { env } from './lib/env';
import { prisma } from './lib/db';
import { logger } from './lib/logger';

/**
 * API entry point.
 *
 * The .env files are loaded before Node starts this file, by
 * `scripts/with-env.mjs` (see the `start` and `dev` scripts). A deployment that
 * runs `node dist/server.js` directly is expected to inject real environment
 * variables instead.
 */
function main(): void {
  // Throws with a readable list of every missing or malformed variable.
  const config = env();

  const app = createApp({
    appUrl: config.APP_URL,
    corsOrigins: config.CORS_ORIGINS.split(','),
    trustProxy: config.TRUST_PROXY,
  });

  const server = app.listen(config.PORT, () => {
    logger.info('API listening', { port: config.PORT, environment: config.NODE_ENV });
  });

  // Stop accepting connections, let in-flight requests finish, then release
  // the database pool. The timer is a backstop for a request that never ends.
  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
