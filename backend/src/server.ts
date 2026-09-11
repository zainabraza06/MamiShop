import path from 'node:path';

/**
 * API entry point.
 *
 * Local .env files are loaded before anything else is imported, which is why
 * the rest of the app is pulled in with dynamic imports below: a static import
 * would evaluate modules that read process.env before the file was loaded.
 * `process.loadEnvFile` never overrides a variable that is already set, so a
 * real deployment's injected environment always wins.
 */
function loadLocalEnv(): void {
  // backend/.env first, then the repository root's shared .env.
  for (const file of [path.resolve('.env'), path.resolve('..', '.env')]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // No file at that path; nothing to load.
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const { env } = await import('./lib/env');
  // Throws with a readable list of every missing or malformed variable.
  const config = env();

  const [{ createApp }, { prisma }, { logger }] = await Promise.all([
    import('./app'),
    import('./lib/db'),
    import('./lib/logger'),
  ]);

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

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
