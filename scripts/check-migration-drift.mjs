import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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
 * Usage: npm run db:check-drift  (SHADOW_DATABASE_URL from the environment or .env)
 */

/**
 * Loads .env for local runs, never overriding a variable that is already set.
 *
 * `node --env-file` would be simpler, but it throws when the file is missing,
 * and CI has no .env — its variables come from the workflow. Anything already
 * in the environment wins, so CI and an explicit shell export are unaffected.
 */
function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

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
