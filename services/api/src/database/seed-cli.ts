import { loadEnv } from '../config/env';
import { Database } from './pool';
import { seedReferenceData } from './seed';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = new Database(env);
  try {
    await db.transaction(async (runner) => {
      await seedReferenceData(runner);
    });
    process.stdout.write('reference data seeded\n');
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
