import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from './load-env.mjs';

/**
 * Fails when schema.prisma has changes with no corresponding migration.
 *
 * Wraps `prisma migrate diff`, which needs a *shadow* database to replay the
 * migration history into. Prisma wipes that database to do it. Passing the real
 * DATABASE_URL as the shadow URL is an easy mistake that silently erases the
 * database — it happened while reproducing CI locally, and emptied a seeded
 * development catalogue. This script refuses to run unless the shadow database
 * is demonstrably a different database.
 *
 * Usage: npm run db:check-drift
 * (SHADOW_DATABASE_URL from the environment, backend/.env or the root .env)
 */

loadEnvFiles();

const shadow = process.env.SHADOW_DATABASE_URL;

if (!shadow) {
  console.error(
    'SHADOW_DATABASE_URL is not set.\n' +
      'Point it at a SEPARATE, disposable database — Prisma wipes it to replay migrations.',
  );
  process.exit(2);
}

/**
 * Identifies a Postgres database by host, port and database name.
 *
 * Query parameters (schema, connection_limit, pgbouncer) are deliberately
 * ignored: the same database reached through a pooler or with a different
 * schema parameter is still the same database, and it would still be wiped.
 */
function databaseIdentity(url) {
  const parsed = new URL(url);
  const port = parsed.port || '5432';
  const name = parsed.pathname.replace(/^\/+/, '');
  return `${parsed.hostname.toLowerCase()}:${port}/${name}`;
}

let shadowIdentity;
try {
  shadowIdentity = databaseIdentity(shadow);
} catch {
  console.error('SHADOW_DATABASE_URL is not a valid connection URL.');
  process.exit(2);
}

for (const [label, value] of [
  ['DATABASE_URL', process.env.DATABASE_URL],
  ['DIRECT_URL', process.env.DIRECT_URL],
]) {
  if (!value) continue;
  let identity;
  try {
    identity = databaseIdentity(value);
  } catch {
    continue;
  }
  if (identity === shadowIdentity) {
    console.error(
      `Refusing to run: SHADOW_DATABASE_URL is the same database as ${label} (${identity}).\n` +
        'Prisma would erase it. Use a separate database for the shadow.',
    );
    process.exit(2);
  }
}

const result = spawnSync(
  'npx',
  [
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    './prisma/migrations',
    '--to-schema-datamodel',
    './prisma/schema.prisma',
    '--shadow-database-url',
    shadow,
    '--exit-code',
  ],
  // A shell is needed on Windows to resolve the npx.cmd shim.
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

// prisma migrate diff --exit-code: 0 = no difference, 2 = difference, 1 = error.
if (result.status === 0) {
  console.log('No drift: the migration history matches schema.prisma.');
  process.exit(0);
}

if (result.status === 2) {
  console.error(
    'schema.prisma has changes with no corresponding migration.\n' +
      'Run: npx prisma migrate dev --name <description>',
  );
  process.exit(1);
}

console.error(`prisma migrate diff failed (exit ${result.status ?? 'unknown'}).`);
process.exit(result.status ?? 1);
