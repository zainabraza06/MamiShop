import { spawn } from 'node:child_process';

/**
 * Runs the API and the storefront together for local development.
 *
 * Each line of output is prefixed with the service it came from. If either
 * service exits, the other is stopped too, so a crashed API never leaves a
 * storefront running against nothing. Ctrl+C stops both.
 *
 * Usage: npm run dev
 */

const services = [
  { name: 'api', workspace: '@momishop/backend', color: 36 },
  { name: 'web', workspace: '@momishop/frontend', color: 35 },
];

let stopping = false;
const children = [];

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

for (const { name, workspace, color } of services) {
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;

  const child = spawn('npm', ['run', 'dev', '-w', workspace], {
    // A shell is needed on Windows to resolve the npm.cmd shim.
    shell: process.platform === 'win32',
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`);
    });
  }

  child.on('exit', (code) => {
    if (!stopping) console.error(`${prefix}exited with code ${code ?? 'unknown'}; stopping.`);
    stopAll(code ?? 1);
  });

  children.push(child);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
