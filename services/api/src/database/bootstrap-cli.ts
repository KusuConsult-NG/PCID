import { loadEnv } from '../config/env';
import { bootstrapPlatformAdministrator } from './bootstrap';
import { Database } from './pool';
import { seedReferenceData } from './seed';

async function main(): Promise<void> {
  const env = loadEnv();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const fullName = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Platform Administrator';
  if (email === undefined || password === undefined) {
    throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.');
  }

  const db = new Database(env);
  try {
    const result = await db.transaction(async (runner) => {
      await seedReferenceData(runner);
      return bootstrapPlatformAdministrator(runner, env, {
        agencyCode: process.env.BOOTSTRAP_AGENCY_CODE ?? 'PLT-PLATFORM',
        agencyName: process.env.BOOTSTRAP_AGENCY_NAME ?? 'Plateau State PCID Platform Office',
        email,
        fullName,
        password,
      });
    });
    if (!result.created) {
      process.stdout.write('The platform is already bootstrapped; nothing was changed.\n');
      return;
    }
    process.stdout.write(
      [
        'Platform administrator created.',
        `  email:            ${result.email}`,
        `  authenticator:    ${result.provisioningUri}`,
        '  recovery codes:',
        ...result.recoveryCodes.map((code) => `    ${code}`),
        '',
        'Record the authenticator and recovery codes now: they are not shown again.',
        'This account holds administrative actions only and no entitlement to citizen data.',
        '',
      ].join('\n'),
    );
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
