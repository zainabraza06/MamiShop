import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from './load-env.mjs';

/**
 * Runs a command with the repository's .env files loaded. See load-env.mjs for
 * why this happens here rather than inside each framework's config.
 *
 * Usage: node ../scripts/with-env.mjs <command> [...args]
 *   e.g. node ../scripts/with-env.mjs next start
 *        node ../scripts/with-env.mjs prisma migrate deploy
 */

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('Usage: node scripts/with-env.mjs <command> [...args]');
  process.exit(2);
}

loadEnvFiles();

const result = spawnSync(command, args, {
  stdio: 'inherit',
  // A shell is needed on Windows to resolve .cmd shims such as next.cmd.
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
