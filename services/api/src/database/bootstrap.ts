import { CryptoService } from '../security/crypto.service';
import { PasswordService, validatePasswordStrength } from '../security/password.service';
import { TotpService, generateRecoveryCodes } from '../security/totp.service';
import type { Env } from '../config/env';
import type { QueryRunner } from './pool';

export interface BootstrapResult {
  readonly created: boolean;
  readonly agencyId: string;
  readonly userId: string;
  readonly email: string;
  readonly totpSecret: string | null;
  readonly provisioningUri: string | null;
  readonly recoveryCodes: readonly string[];
}

export interface BootstrapInput {
  readonly agencyCode: string;
  readonly agencyName: string;
  readonly email: string;
  readonly fullName: string;
  readonly password: string;
}

/**
 * Create the first platform administrator so the system can be administered
 * through its own API from then on.
 *
 * Deliberately narrow. The account it creates holds PLATFORM_ADMINISTRATOR, which
 * carries administrative actions and no entitlement to citizen data whatsoever
 * (§7) - so the bootstrap path cannot be used to read the registry, and the first
 * operator has to create properly scoped accounts for that like everyone else.
 *
 * Idempotent: running it again against an initialised system changes nothing and
 * reports `created: false`.
 */
export async function bootstrapPlatformAdministrator(
  runner: QueryRunner,
  env: Env,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const existing = await runner.queryOne<{ id: string; agency_id: string; email: string }>(
    'SELECT id, agency_id, email FROM government_user WHERE lower(email) = lower($1)',
    [input.email],
  );
  if (existing !== null) {
    return {
      created: false,
      agencyId: existing.agency_id,
      userId: existing.id,
      email: existing.email,
      totpSecret: null,
      provisioningUri: null,
      recoveryCodes: [],
    };
  }

  const problems = validatePasswordStrength(input.password, [input.email, input.fullName]);
  if (problems.length > 0) {
    throw new Error(`The bootstrap password does not meet policy: ${problems.join(' ')}`);
  }

  const agency = await runner.queryOne<{ id: string }>(
    `INSERT INTO agency (code, name, category, status, max_classification, data_sharing_agreement)
     VALUES ($1, $2, 'MDA', 'ACTIVE', 'INTERNAL', 'NONE')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [input.agencyCode, input.agencyName],
  );
  if (agency === null) throw new Error('bootstrap: agency upsert returned no row');

  const passwords = new PasswordService();
  const totp = new TotpService();
  const crypto = new CryptoService(env);
  const stored = await passwords.hash(input.password);
  const secret = totp.generateSecret();
  const recoveryCodes = generateRecoveryCodes();

  const user = await runner.queryOne<{ id: string; email: string }>(
    `INSERT INTO government_user (
       agency_id, email, full_name, status, password_hash, password_algorithm, password_params,
       must_change_password, mfa_enrolled, clearance, jurisdiction_scope
     ) VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6::jsonb,true,true,'INTERNAL','STATE')
     RETURNING id, email`,
    [
      agency.id,
      input.email,
      input.fullName,
      stored.hash,
      stored.algorithm,
      JSON.stringify(stored.params),
    ],
  );
  if (user === null) throw new Error('bootstrap: user insert returned no row');

  const role = await runner.queryOne<{ id: string }>(
    "SELECT id FROM role WHERE name = 'PLATFORM_ADMINISTRATOR'",
  );
  if (role === null) {
    throw new Error('bootstrap: roles are not seeded. Run the reference data seed first.');
  }
  await runner.query('INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)', [
    user.id,
    role.id,
  ]);

  // The authenticator is pre-confirmed for the bootstrap account only, because
  // there is no existing operator who could confirm it.
  await runner.query(
    `INSERT INTO mfa_credential (user_id, kind, secret_ciphertext, label, confirmed_at)
     VALUES ($1,'TOTP',$2,'Bootstrap authenticator', now())`,
    [user.id, crypto.encrypt(secret)],
  );
  for (const code of recoveryCodes) {
    await runner.query(
      `INSERT INTO mfa_credential (user_id, kind, secret_ciphertext) VALUES ($1,'RECOVERY_CODE',$2)`,
      [user.id, crypto.encrypt(code)],
    );
  }

  await runner.query(
    `INSERT INTO audit_event (action, outcome, actor_type, resource_type, resource_id,
                              correlation_id, detail, prev_hash, hash)
     VALUES ('ADMIN_SYSTEM_MANAGE','PERMITTED','SYSTEM','GOVERNMENT_USER',$1,$2,$3::jsonb,'','')`,
    [
      user.id,
      `bootstrap-${Date.now()}`,
      JSON.stringify({ change: 'PLATFORM_BOOTSTRAPPED', email: input.email }),
    ],
  );

  return {
    created: true,
    agencyId: agency.id,
    userId: user.id,
    email: user.email,
    totpSecret: secret,
    provisioningUri: totp.provisioningUri(secret, input.email, 'PCID Plateau State'),
    recoveryCodes,
  };
}
