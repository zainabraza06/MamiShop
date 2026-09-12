import { existsSync, readFileSync } from 'node:fs';

/**
 * Loads a .env file into process.env, never overriding a variable that is
 * already set.
 *
 * `node --env-file` would be simpler, but it throws when the file is missing,
 * and CI has no .env — its variables come from the workflow. Anything already
 * in the environment wins, so CI and an explicit shell export are unaffected.
 */
function loadDotEnv(path) {
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

/**
 * Loads backend/.env, then the repository root's .env.
 *
 * Database scripts run from backend/, but local configuration lives in the
 * root .env shared with the storefront. The Prisma CLI only looks beside the
 * schema, so without this it would not find DATABASE_URL.
 */
export function loadEnvFiles() {
  loadDotEnv('.env');
  loadDotEnv('../.env');
}
