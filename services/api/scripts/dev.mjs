/**
 * Run the API in development, rebuilding as you type.
 *
 * Not `tsx`: esbuild does not emit `design:paramtypes`, and without it Nest
 * injects nothing into a constructor - the guard comes up with no Reflector and
 * every request fails at the first `getAllAndOverride`. The integration suite
 * compiles with `tsc` for the same reason. So this watches with the real
 * compiler and restarts the built output.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const compiler = spawn(
  process.execPath,
  [
    resolve(apiDirectory, '../../node_modules/typescript/bin/tsc'),
    '-b',
    '--watch',
    '--preserveWatchOutput',
  ],
  { cwd: apiDirectory, stdio: 'inherit' },
);

const service = spawn(process.execPath, ['--watch', 'dist/main.js'], {
  cwd: apiDirectory,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim() },
});

const children = [compiler, service];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
for (const child of children) child.on('exit', (code) => stop(code ?? 0));
