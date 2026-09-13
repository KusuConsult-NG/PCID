import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { findRepositoryRoot } from '../../database/paths';

import { buildOpenApiDocument } from './registry';
import './routes-index';

const target = join(findRepositoryRoot(), 'docs', 'openapi.json');
mkdirSync(dirname(target), { recursive: true });
const document = buildOpenApiDocument({
  version: process.env.npm_package_version ?? '1.0.0',
  serverUrl: process.env.PLATFORM_BASE_URL ?? 'http://localhost:3000',
});
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
const pathCount = Object.keys(document.paths as Record<string, unknown>).length;
process.stdout.write(`wrote ${target} (${pathCount} paths)\n`);
