import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, resolved from this file rather than from the caller's cwd. */
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Loads a .env file into process.env, never overriding a variable that is
 * already set.
 *
 * `node --env-file` would be simpler, but it throws when the file is missing,
 * and CI has no .env — its variables come from the workflow. Anything already
 * in the environment wins, so CI and an explicit shell export are unaffected.
 */
function loadDotEnv(file) {
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
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
 * Loads the workspace's own .env, then the repository root's shared one.
 *
 * Both services read the same root file, and it must be in the **real process
 * environment before the framework starts**. Loading it from inside
 * next.config.mjs is not enough: that runs in the Next CLI process, and the
 * runtimes that serve requests get a snapshot of the environment as it was at
 * launch — which is how the storefront's proxy came to have no AUTH_SECRET and
 * treat every signed-in visitor as anonymous.
 */
export function loadEnvFiles() {
  loadDotEnv(path.resolve('.env'));
  loadDotEnv(path.join(repositoryRoot, '.env'));
}
