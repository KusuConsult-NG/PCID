import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Locate the repository's migrations directory by walking upward.
 *
 * Resolved by search rather than by a fixed `../../..` chain so that the same
 * code works from `src/` under a TypeScript loader, from `dist/` in the deployed
 * container, and from a test build output - three layouts at different depths.
 */
export function findMigrationsDirectory(startAt: string = __dirname): string {
  let current = resolve(startAt);
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(current, 'db', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not locate db/migrations starting from ${startAt}`);
}

/** Locate the repository root, identified by the workspace package.json. */
export function findRepositoryRoot(startAt: string = __dirname): string {
  return dirname(dirname(findMigrationsDirectory(startAt)));
}
