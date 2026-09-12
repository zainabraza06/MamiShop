import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from './load-env.mjs';

/**
 * Runs a command with the .env files loaded. See load-env.mjs.
 *
 * Usage: node scripts/with-env.mjs <command> [...args]
 *   e.g. node scripts/with-env.mjs prisma migrate dev
 */

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('Usage: node scripts/with-env.mjs <command> [...args]');
  process.exit(2);
}

loadEnvFiles();

const result = spawnSync(command, args, {
  stdio: 'inherit',
  // A shell is needed on Windows to resolve .cmd shims such as prisma.cmd.
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
