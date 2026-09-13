import { loadEnv } from '../config/env';
import { migrate } from './migrator';
import { findMigrationsDirectory } from './paths';

async function main(): Promise<void> {
  const env = loadEnv();
  const result = await migrate(env.DATABASE_URL, findMigrationsDirectory(), (message) =>
    process.stdout.write(`${message}\n`),
  );
  process.stdout.write(
    `migrations: ${result.applied.length} applied, ${result.alreadyApplied.length} already present\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
