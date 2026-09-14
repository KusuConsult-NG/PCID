/**
 * Finish the standalone build.
 *
 * `next build` with `output: 'standalone'` emits a server and the minimum set
 * of dependencies it traced, but deliberately leaves the static assets and the
 * public directory where they are - it cannot know whether they will be served
 * by the Node process or by a CDN in front of it. The portal serves its own, so
 * they are copied in here and the result is a directory that runs anywhere with
 * a Node runtime and nothing else.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const portal = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = resolve(portal, '.next/standalone/apps/portal');

if (!existsSync(standalone)) {
  throw new Error(`No standalone build at ${standalone}. Run "next build" first.`);
}

mkdirSync(resolve(standalone, '.next'), { recursive: true });
cpSync(resolve(portal, '.next/static'), resolve(standalone, '.next/static'), { recursive: true });

const publicDirectory = resolve(portal, 'public');
if (existsSync(publicDirectory)) {
  cpSync(publicDirectory, resolve(standalone, 'public'), { recursive: true });
}

process.stdout.write('standalone build assembled at .next/standalone/apps/portal\n');
