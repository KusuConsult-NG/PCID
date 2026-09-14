import { randomBytes } from 'node:crypto';

import type { Env } from '../config/env';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';
import { CryptoService } from '../security/crypto.service';
import { PasswordService } from '../security/password.service';
import { TotpService } from '../security/totp.service';
import { Dataset } from './dataset';
import { LOAD_AGENCY_PREFIX, LOAD_CHANNEL, LOAD_PERSONAS } from './personas';
import { LOAD_EMAIL_DOMAIN, LOAD_PHONE_PREFIX } from './personas';
import type { LoadAccount, LoadManifest, LoadPersona } from './personas';

type SampledPerson = LoadManifest['samples']['people'][number];
import type { WardReference } from './dataset';

/**
 * Volume generation for load measurement (§81).
 *
 * This is the one tool in the repository that writes registry rows without going
 * through the API, and it says so plainly rather than hiding it. A statewide
 * population cannot be created through the registration endpoint in any usable
 * time - the duplicate-detection pass alone is quadratic in candidate names - and
 * a load test that takes a week to set up is a load test nobody runs.
 *
 * The compensating controls:
 *
 *  - It refuses to run when NODE_ENV is production, like every other synthetic
 *    data path in the platform (§77, §78).
 *  - It refuses to run against a database that already holds registry rows it
 *    did not create, unless explicitly forced, so it cannot be pointed at a real
 *    register by mistake.
 *  - Every row it writes is marked: citizens carry the LOAD_TEST registration
 *    channel, so `DELETE FROM citizen WHERE registration_channel = 'LOAD_TEST'`
 *    is an exact undo and an auditor can tell generated rows from real ones with
 *    one predicate.
 *  - The accounts it creates hold ordinary roles and ordinary clearances. None of
 *    them is privileged beyond the role it names, so a load run exercises the
 *    same authorisation path an officer does.
 */

export { LOAD_CHANNEL, LOAD_AGENCY_PREFIX, LOAD_PERSONAS } from './personas';
export type { LoadPersona, LoadAccount, LoadManifest } from './personas';

/** Postgres accepts 65535 parameters per statement; batches stay well inside it. */
const CITIZEN_BATCH = 500;
const GENERIC_BATCH = 1_000;

export interface VolumeOptions {
  readonly citizens: number;
  readonly incidents: number;
  readonly cases: number;
  readonly auditEvents: number;
  /** Response units, so the command map and the dispatch queries have a fleet. */
  readonly units: number;
  /** Accounts created per persona. One virtual user drives one account. */
  readonly accountsPerPersona: number;
  readonly seed: number;
  /** Write into a database that already holds registry rows. */
  readonly force: boolean;
}

export interface ProgressReport {
  (stage: string, done: number, total: number, elapsedMs: number): void;
}

export async function generateVolume(
  db: Database,
  env: Env,
  options: VolumeOptions,
  report: ProgressReport,
): Promise<LoadManifest> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Load volume must never be generated in production.');
  }
  await assertSafeTarget(db, options.force);

  const wards = await db.query<{ code: string; lga_code: string }>(
    'SELECT code, lga_code FROM ward ORDER BY code',
  );
  const dataset = new Dataset(
    options.seed,
    wards.map((row): WardReference => ({ code: row.code, lgaCode: row.lga_code })),
  );

  const accounts = await createAccounts(db, env, options, report);
  const citizens = await createCitizens(db, dataset, options, report);
  const incidents = await createIncidents(db, dataset, options, accounts, report);
  const cases = await createCases(db, dataset, options, accounts, citizens.pcids, report);
  await createUnits(db, dataset, options, report);
  const auditEvents = await createAuditEvents(db, options, citizens.pcids, accounts, report);

  await db.query('ANALYZE citizen');
  await db.query('ANALYZE incident');
  await db.query('ANALYZE investigation_case');
  await db.query('ANALYZE audit_event');
  await db.query('ANALYZE response_unit');

  return {
    generatedAt: new Date().toISOString(),
    seed: options.seed,
    counts: {
      citizens: options.citizens,
      incidents: options.incidents,
      cases: options.cases,
      auditEvents,
    },
    accounts,
    samples: {
      pcids: citizens.pcids,
      people: citizens.people,
      familyNames: citizens.familyNames,
      incidentNumbers: incidents,
      caseNumbers: cases,
      lgaCodes: [...new Set(wards.map((row) => row.lga_code))],
    },
  };
}

/**
 * Refuse a database holding registry rows this tool did not write. The check is
 * the difference between a benchmark and an incident.
 */
async function assertSafeTarget(db: Database, force: boolean): Promise<void> {
  if (force) return;
  const row = await db.queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM citizen WHERE registration_channel <> $1`,
    [LOAD_CHANNEL],
  );
  const foreign = Number(row?.count ?? 0);
  // The demo environment leaves exactly one resident behind, and the end-to-end
  // suites expect it, so a handful of rows is the ordinary development case.
  if (foreign > 25) {
    throw new Error(
      `This database holds ${foreign} citizen records that the load harness did not create. ` +
        'Point DATABASE_URL at a database used for measurement, or pass --force if you are certain.',
    );
  }
}

async function createAccounts(
  db: Database,
  env: Env,
  options: VolumeOptions,
  report: ProgressReport,
): Promise<LoadAccount[]> {
  const started = Date.now();
  const passwords = new PasswordService();
  const totp = new TotpService();
  const crypto = new CryptoService(env);
  const accounts: LoadAccount[] = [];
  const total = LOAD_PERSONAS.length * options.accountsPerPersona;

  for (const persona of LOAD_PERSONAS) {
    const agencyId = await upsertAgency(db, persona);
    const roleIds = await resolveRoles(db, persona.roles);

    for (let index = 0; index < options.accountsPerPersona; index += 1) {
      const email = `${persona.key}-${String(index).padStart(3, '0')}@${LOAD_EMAIL_DOMAIN}`;
      const password = `Lq8${randomBytes(12).toString('base64url')}Vt3`;
      const secret = totp.generateSecret();
      const stored = await passwords.hash(password);

      await db.transaction(async (runner) => {
        const user = await runner.queryOne<{ id: string }>(
          `INSERT INTO government_user (
             agency_id, email, full_name, status, password_hash, password_algorithm, password_params,
             must_change_password, mfa_enrolled, clearance, jurisdiction_scope
           ) VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6::jsonb,false,true,$7,'STATE')
           ON CONFLICT (lower(email)) DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             password_algorithm = EXCLUDED.password_algorithm,
             password_params = EXCLUDED.password_params,
             status = 'ACTIVE', locked_until = NULL, failed_login_count = 0
           RETURNING id`,
          [
            agencyId,
            email,
            `Load ${persona.key} ${index}`,
            stored.hash,
            stored.algorithm,
            JSON.stringify(stored.params),
            persona.clearance,
          ],
        );
        if (user === null) throw new Error(`load account upsert returned no row for ${email}`);

        for (const roleId of roleIds) {
          await runner.query(
            'INSERT INTO user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [user.id, roleId],
          );
        }
        // The authenticator is written confirmed. These accounts belong to a
        // harness, not to a person who could enrol one.
        await runner.query('DELETE FROM mfa_credential WHERE user_id = $1', [user.id]);
        await runner.query(
          `INSERT INTO mfa_credential (user_id, kind, secret_ciphertext, label, confirmed_at)
           VALUES ($1,'TOTP',$2,'Load harness authenticator', now())`,
          [user.id, crypto.encrypt(secret)],
        );
      });

      accounts.push({
        persona: persona.key,
        email,
        password,
        totpSecret: secret,
        roles: persona.roles,
      });
      report('accounts', accounts.length, total, Date.now() - started);
    }
  }
  return accounts;
}

async function upsertAgency(db: Database, persona: LoadPersona): Promise<string> {
  return db.transaction(async (runner) => {
    const agency = await runner.queryOne<{ id: string }>(
      `INSERT INTO agency (code, name, category, status, max_classification,
                           data_sharing_agreement, jurisdiction_scope, api_integration_status)
       VALUES ($1,$2,$3,'ACTIVE',$4,'SIGNED','STATE','LIVE')
       ON CONFLICT (code) DO UPDATE SET status = 'ACTIVE', data_sharing_agreement = 'SIGNED'
       RETURNING id`,
      [
        persona.agencyCode,
        persona.agencyName,
        persona.agencyCategory,
        persona.agencyMaxClassification,
      ],
    );
    if (agency === null) throw new Error(`agency upsert returned no row for ${persona.agencyCode}`);
    if (persona.lawEnforcementCompartment) {
      await runner.query(
        `INSERT INTO agency_compartment_grant (agency_id, compartment, legal_basis)
         VALUES ($1,'LAW_ENFORCEMENT_RESTRICTED',$2)
         ON CONFLICT (agency_id, compartment) DO NOTHING`,
        [agency.id, 'Load measurement environment: synthetic records only.'],
      );
    }
    return agency.id;
  });
}

async function resolveRoles(db: Database, names: readonly string[]): Promise<string[]> {
  const rows = await db.query<{ id: string }>('SELECT id FROM role WHERE name = ANY($1::text[])', [
    [...names],
  ]);
  if (rows.length !== names.length) {
    throw new Error(`Roles are not seeded: expected ${names.join(', ')}. Run npm run db:seed.`);
  }
  return rows.map((row) => row.id);
}

async function createCitizens(
  db: Database,
  dataset: Dataset,
  options: VolumeOptions,
  report: ProgressReport,
): Promise<{ pcids: string[]; people: SampledPerson[]; familyNames: string[] }> {
  const started = Date.now();
  const pcids: string[] = [];
  const people: SampledPerson[] = [];
  const familyNames = new Set<string>();
  // A seeded byte source, so the PCIDs a run allocates are the same next time.
  const random = dataset.source;
  const pcidSource = (byteLength: number): Buffer => {
    const bytes = Buffer.alloc(byteLength);
    for (let i = 0; i < byteLength; i += 1) bytes[i] = random.int(0, 255);
    return bytes;
  };

  let written = 0;
  while (written < options.citizens) {
    const size = Math.min(CITIZEN_BATCH, options.citizens - written);
    const batch = Array.from({ length: size }, () => dataset.citizen(pcidSource));

    await db.transaction(async (runner) => {
      await insertMany(
        runner,
        'INSERT INTO pcid_allocation (pcid, channel) VALUES',
        batch.map((citizen) => [citizen.pcid, LOAD_CHANNEL]),
        'ON CONFLICT (pcid) DO NOTHING',
      );
      await insertMany(
        runner,
        `INSERT INTO citizen (
           pcid, status, given_name, middle_name, family_name, display_name, sex, date_of_birth,
           phone_primary, email, residential_address, lga_code, ward_code, verification_level,
           classification, registration_channel
         ) VALUES`,
        batch.map((citizen) => [
          citizen.pcid,
          citizen.status,
          citizen.givenName,
          citizen.middleName,
          citizen.familyName,
          citizen.displayName,
          citizen.sex,
          citizen.dateOfBirth,
          citizen.phonePrimary,
          citizen.email,
          citizen.residentialAddress,
          citizen.lgaCode,
          citizen.wardCode,
          citizen.verificationLevel,
          'CONFIDENTIAL',
          LOAD_CHANNEL,
        ]),
        'ON CONFLICT (pcid) DO NOTHING',
      );
    });

    for (const citizen of batch) {
      // A bounded sample: the driver needs identifiers that exist, not all of them.
      if (pcids.length < 5_000 && random.chance(0.2)) pcids.push(citizen.pcid);
      if (people.length < 5_000 && random.chance(0.2)) {
        people.push({
          name: citizen.displayName,
          dateOfBirth: citizen.dateOfBirth,
          lgaCode: citizen.lgaCode,
        });
      }
      familyNames.add(citizen.familyName);
    }
    written += size;
    report('citizens', written, options.citizens, Date.now() - started);
  }

  if (pcids.length === 0 && options.citizens > 0) {
    const rows = await db.query<{
      pcid: string;
      display_name: string;
      date_of_birth: Date;
      lga_code: string | null;
    }>(
      `SELECT pcid, display_name, date_of_birth, lga_code FROM citizen
        WHERE registration_channel = $1 LIMIT 500`,
      [LOAD_CHANNEL],
    );
    pcids.push(...rows.map((row) => row.pcid));
    people.push(
      ...rows.map((row) => ({
        name: row.display_name,
        dateOfBirth: row.date_of_birth.toISOString().slice(0, 10),
        lgaCode: row.lga_code,
      })),
    );
  }
  return { pcids, people, familyNames: [...familyNames] };
}

async function createIncidents(
  db: Database,
  dataset: Dataset,
  options: VolumeOptions,
  accounts: readonly LoadAccount[],
  report: ProgressReport,
): Promise<string[]> {
  if (options.incidents === 0) return [];
  const started = Date.now();
  const year = new Date().getUTCFullYear().toString();
  const first = await reserveReferences(db, 'INCIDENT', year, options.incidents);
  const agencyId = await agencyIdFor(db, `${LOAD_AGENCY_PREFIX}-EMS`);
  const reporter = await userIdFor(db, accounts, 'dispatcher');
  const numbers: string[] = [];
  const now = Date.now();

  let written = 0;
  while (written < options.incidents) {
    const size = Math.min(GENERIC_BATCH, options.incidents - written);
    const rows = Array.from({ length: size }, (_unused, offset) => {
      const incident = dataset.incident(now, 540);
      const number = `INC-${year}-${String(first + written + offset).padStart(6, '0')}`;
      return { number, incident };
    });

    await db.transaction(async (runner) => {
      const created = await insertManyReturning<{ id: string; incident_number: string }>(
        runner,
        `INSERT INTO incident (
           incident_number, type, severity, status, description, address_text, lga_code, ward_code,
           latitude, longitude, reporter_type, reporter_user_id, lead_agency_id, reported_at
         ) VALUES`,
        rows.map(({ number, incident }) => [
          number,
          incident.type,
          incident.severity,
          incident.status,
          incident.description,
          incident.addressText,
          incident.lgaCode,
          incident.wardCode,
          incident.latitude,
          incident.longitude,
          'GOVERNMENT_USER',
          reporter,
          agencyId,
          incident.reportedAt,
        ]),
        'ON CONFLICT (incident_number) DO NOTHING RETURNING id, incident_number',
      );

      // What the create path writes alongside the incident, and the reason a
      // dispatcher can open one at all: the incident-binding gate asks whether
      // this account or its agency is attached to *this* incident, so a seeded
      // incident with no attachment would be refused to everybody and the run
      // would measure refusals instead of work (§9).
      await insertMany(
        runner,
        'INSERT INTO incident_agency (incident_id, agency_id, role) VALUES',
        created.map((row) => [row.id, agencyId, 'LEAD']),
        'ON CONFLICT DO NOTHING',
      );
      await insertMany(
        runner,
        'INSERT INTO incident_officer (incident_id, user_id, role) VALUES',
        created.map((row) => [row.id, reporter, 'REPORTING']),
        'ON CONFLICT DO NOTHING',
      );
    });

    for (const row of rows) if (numbers.length < 2_000) numbers.push(row.number);
    written += size;
    report('incidents', written, options.incidents, Date.now() - started);
  }
  return numbers;
}

async function createCases(
  db: Database,
  dataset: Dataset,
  options: VolumeOptions,
  accounts: readonly LoadAccount[],
  pcids: readonly string[],
  report: ProgressReport,
): Promise<string[]> {
  if (options.cases === 0) return [];
  const started = Date.now();
  const year = new Date().getUTCFullYear().toString();
  const first = await reserveReferences(db, 'CASE', year, options.cases);
  const agencyId = await agencyIdFor(db, `${LOAD_AGENCY_PREFIX}-POLICE`);
  const investigators = await userIdsFor(db, accounts, 'investigator');
  if (investigators.length === 0) throw new Error('no investigator account to assign cases to');
  const random = dataset.source;
  const numbers: string[] = [];

  let written = 0;
  while (written < options.cases) {
    const size = Math.min(GENERIC_BATCH, options.cases - written);
    const rows = Array.from({ length: size }, (_unused, offset) => ({
      number: `CASE-${year}-${String(first + written + offset).padStart(5, '0')}`,
      record: dataset.investigationCase(),
      // Every case is worked by somebody: an unassigned case would make the
      // case-binding gate refuse, and a load run that measures refusals measures
      // the wrong thing.
      owner: investigators[random.int(0, investigators.length - 1)] as string,
    }));

    await db.transaction(async (runner) => {
      const created = await insertManyReturning<{ id: string; case_number: string }>(
        runner,
        `INSERT INTO investigation_case (
           case_number, type, title, summary, status, agency_id, lga_code, opened_by_user_id
         ) VALUES`,
        rows.map(({ number, record, owner }) => [
          number,
          record.type,
          record.title,
          record.summary,
          record.status,
          agencyId,
          record.lgaCode,
          owner,
        ]),
        'ON CONFLICT (case_number) DO NOTHING RETURNING id, case_number',
      );
      const byNumber = new Map(created.map((row) => [row.case_number, row.id]));

      await insertMany(
        runner,
        'INSERT INTO case_assignment (case_id, user_id, role, assigned_by) VALUES',
        rows
          .filter(({ number }) => byNumber.has(number))
          .map(({ number, owner }) => [byNumber.get(number), owner, 'INVESTIGATOR', owner]),
        'ON CONFLICT (case_id, user_id) DO NOTHING',
      );

      // Roughly two thirds of cases name a person. The rest do not, which is
      // what keeps the case-bound gate meaningful in the mix.
      const subjects = rows
        .filter(({ number }) => byNumber.has(number) && pcids.length > 0 && random.chance(0.66))
        .map(({ number, owner }) => [
          byNumber.get(number),
          'CITIZEN',
          pcids[random.int(0, pcids.length - 1)],
          'SUBJECT_OF_INTEREST',
          owner,
          'Generated for load measurement.',
        ]);
      await insertMany(
        runner,
        `INSERT INTO case_subject (case_id, subject_type, subject_id, subject_role,
                                   linked_by_user_id, justification) VALUES`,
        subjects,
        'ON CONFLICT (case_id, subject_type, subject_id) DO NOTHING',
      );
    });

    for (const row of rows) if (numbers.length < 2_000) numbers.push(row.number);
    written += size;
    report('cases', written, options.cases, Date.now() - started);
  }
  return numbers;
}

/**
 * The fleet. Real positions, reported by the unit about itself - which is the
 * only kind of live position the platform holds, and the reason the command map
 * has no layer that could show a person (§16).
 */
async function createUnits(
  db: Database,
  dataset: Dataset,
  options: VolumeOptions,
  report: ProgressReport,
): Promise<void> {
  if (options.units === 0) return;
  const started = Date.now();
  const agencyId = await agencyIdFor(db, `${LOAD_AGENCY_PREFIX}-EMS`);
  const random = dataset.source;
  const types = ['AMBULANCE', 'FIRE_TRUCK', 'RESCUE_TEAM', 'POLICE_UNIT', 'EMERGENCY_VEHICLE'];
  const statuses = ['AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'EN_ROUTE', 'ON_SCENE', 'OFFLINE'];
  const wards = await db.query<{ code: string; lga_code: string }>(
    'SELECT code, lga_code FROM ward ORDER BY code',
  );

  const rows = Array.from({ length: options.units }, (_unused, index) => {
    const ward = wards[random.int(0, wards.length - 1)];
    // Most units have reported a position; some have not booked on, and the map
    // has to say so rather than place them at a guess.
    const positioned = random.chance(0.8);
    return [
      `LOAD-${String(index).padStart(5, '0')}`,
      agencyId,
      types[random.int(0, types.length - 1)],
      statuses[random.int(0, statuses.length - 1)],
      ward?.lga_code ?? null,
      positioned ? Number((8.4 + random.next() * 2.0).toFixed(6)) : null,
      positioned ? Number((8.5 + random.next() * 2.0).toFixed(6)) : null,
      positioned ? new Date(Date.now() - random.int(0, 3_600_000)) : null,
      positioned ? 'REAL_TIME_DEVICE' : null,
    ];
  });

  for (let offset = 0; offset < rows.length; offset += GENERIC_BATCH) {
    const batch = rows.slice(offset, offset + GENERIC_BATCH);
    await db.transaction(async (runner) => {
      await insertMany(
        runner,
        `INSERT INTO response_unit (
           unit_code, agency_id, type, status, home_lga_code,
           latitude, longitude, location_reported_at, location_source
         ) VALUES`,
        batch,
        'ON CONFLICT (unit_code) DO NOTHING',
      );
    });
    report(
      'units',
      Math.min(offset + GENERIC_BATCH, rows.length),
      rows.length,
      Date.now() - started,
    );
  }
}

/**
 * Audit volume.
 *
 * Written through the ordinary insert path, so every row is chained by the
 * database trigger exactly as a real access would be. That makes this the
 * slowest part of generation and the most informative: the rate it sustains is
 * the platform's ceiling on audited operations, and the probe measures it under
 * concurrency separately.
 */
async function createAuditEvents(
  db: Database,
  options: VolumeOptions,
  pcids: readonly string[],
  accounts: readonly LoadAccount[],
  report: ProgressReport,
): Promise<number> {
  if (options.auditEvents === 0) return 0;
  const started = Date.now();
  const actors = await userIdsFor(db, accounts, 'counter');
  const actions = ['CITIZEN_SEARCH', 'CITIZEN_VIEW', 'CITIZEN_VERIFY'] as const;
  const batch = 250;
  let written = 0;

  while (written < options.auditEvents) {
    const size = Math.min(batch, options.auditEvents - written);
    await db.transaction(async (runner) => {
      await insertMany(
        runner,
        `INSERT INTO audit_event (
           action, outcome, actor_type, actor_id, purpose, resource_type, subject_pcid,
           citizen_visibility, correlation_id, occurred_at, detail, prev_hash, hash
         ) VALUES`,
        Array.from({ length: size }, (_unused, offset) => {
          const index = written + offset;
          return [
            actions[index % actions.length],
            index % 19 === 0 ? 'DENIED' : 'PERMITTED',
            'GOVERNMENT_USER',
            actors.length === 0 ? null : actors[index % actors.length],
            'SERVICE_DELIVERY',
            'CITIZEN',
            pcids.length === 0 ? null : pcids[index % pcids.length],
            'ACCESS_VISIBLE_TO_CITIZEN',
            `load-${options.seed}-${index}`,
            new Date(Date.now() - index * 137),
            JSON.stringify({ generated: true }),
            '',
            '',
          ];
        }),
        '',
      );
    });
    written += size;
    report('audit', written, options.auditEvents, Date.now() - started);
  }
  return written;
}

async function reserveReferences(
  db: Database,
  scope: string,
  period: string,
  count: number,
): Promise<number> {
  const row = await db.queryOne<{ first: string }>(
    `INSERT INTO reference_sequence (scope, period, next_value)
     VALUES ($1, $2, $3::bigint + 1)
     ON CONFLICT (scope, period)
     DO UPDATE SET next_value = reference_sequence.next_value + $3::bigint
     RETURNING (reference_sequence.next_value - $3::bigint) AS first`,
    [scope, period, count],
  );
  if (row === null) throw new Error(`could not reserve ${count} ${scope} references`);
  return Number(row.first);
}

async function agencyIdFor(db: Database, code: string): Promise<string> {
  const row = await db.queryOne<{ id: string }>('SELECT id FROM agency WHERE code = $1', [code]);
  if (row === null) throw new Error(`load agency ${code} is missing`);
  return row.id;
}

async function userIdFor(
  db: Database,
  accounts: readonly LoadAccount[],
  persona: string,
): Promise<string> {
  const ids = await userIdsFor(db, accounts, persona);
  if (ids.length === 0) throw new Error(`no ${persona} account was created`);
  return ids[0] as string;
}

async function userIdsFor(
  db: Database,
  accounts: readonly LoadAccount[],
  persona: string,
): Promise<string[]> {
  const emails = accounts.filter((account) => account.persona === persona).map((a) => a.email);
  if (emails.length === 0) return [];
  const rows = await db.query<{ id: string }>(
    'SELECT id FROM government_user WHERE email = ANY($1::text[])',
    [emails],
  );
  return rows.map((row) => row.id);
}

/** A multi-row INSERT built from a parameter matrix. Nothing is interpolated. */
async function insertMany(
  runner: QueryRunner,
  prefix: string,
  rows: readonly (readonly unknown[])[],
  suffix: string,
): Promise<void> {
  if (rows.length === 0) return;
  const { sql, values } = buildInsert(prefix, rows, suffix);
  await runner.query(sql, values);
}

async function insertManyReturning<T extends Record<string, unknown>>(
  runner: QueryRunner,
  prefix: string,
  rows: readonly (readonly unknown[])[],
  suffix: string,
): Promise<T[]> {
  if (rows.length === 0) return [];
  const { sql, values } = buildInsert(prefix, rows, suffix);
  return runner.query(sql, values) as Promise<T[]>;
}

function buildInsert(
  prefix: string,
  rows: readonly (readonly unknown[])[],
  suffix: string,
): { sql: string; values: unknown[] } {
  const width = (rows[0] as readonly unknown[]).length;
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    if (row.length !== width) throw new Error('every row in a batch must have the same width');
    const placeholders = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(',')})`;
  });
  return { sql: `${prefix} ${tuples.join(',')} ${suffix}`, values };
}

/** Remove everything the harness created, in dependency order. */
export async function removeVolume(db: Database, env: Env): Promise<Record<string, number>> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Load volume must never be removed in production - there is none.');
  }
  const removed: Record<string, number> = {};
  const counts = await db.transaction(async (runner) => {
    const results: Record<string, number> = {};
    const agencies = await runner.query<{ id: string }>(
      'SELECT id FROM agency WHERE code LIKE $1',
      [`${LOAD_AGENCY_PREFIX}%`],
    );
    const agencyIds = agencies.map((row) => row.id);
    for (const [label, sql, params] of [
      [
        'case_subject',
        'DELETE FROM case_subject WHERE case_id IN (SELECT id FROM investigation_case WHERE agency_id = ANY($1::uuid[]))',
        [agencyIds],
      ],
      [
        'case_assignment',
        'DELETE FROM case_assignment WHERE case_id IN (SELECT id FROM investigation_case WHERE agency_id = ANY($1::uuid[]))',
        [agencyIds],
      ],
      [
        'investigation_case',
        'DELETE FROM investigation_case WHERE agency_id = ANY($1::uuid[])',
        [agencyIds],
      ],
      [
        'dispatch',
        'DELETE FROM dispatch WHERE incident_id IN (SELECT id FROM incident WHERE lead_agency_id = ANY($1::uuid[]))',
        [agencyIds],
      ],
      ['incident', 'DELETE FROM incident WHERE lead_agency_id = ANY($1::uuid[])', [agencyIds]],
      ['response_unit', 'DELETE FROM response_unit WHERE agency_id = ANY($1::uuid[])', [agencyIds]],
      [
        'emergency_contact',
        'DELETE FROM emergency_contact WHERE citizen_id IN (SELECT id FROM citizen WHERE registration_channel = $1 OR phone_primary LIKE $2)',
        [LOAD_CHANNEL, `${LOAD_PHONE_PREFIX}%`],
      ],
      // Two markers, because a load run creates registry rows two ways. The bulk
      // are written by the seeder and carry the LOAD_TEST channel. The rest are
      // written by the run itself through the registration endpoint, like any
      // other registration - which is the point of exercising it, and means they
      // carry an ordinary channel. The telephone number marks those: the 0700
      // block is not allocated to any Nigerian operator, so no real record holds
      // one.
      [
        'citizen',
        'DELETE FROM citizen WHERE registration_channel = $1 OR phone_primary LIKE $2',
        [LOAD_CHANNEL, `${LOAD_PHONE_PREFIX}%`],
      ],
      [
        'user_role',
        'DELETE FROM user_role WHERE user_id IN (SELECT id FROM government_user WHERE agency_id = ANY($1::uuid[]))',
        [agencyIds],
      ],
      [
        'mfa_credential',
        'DELETE FROM mfa_credential WHERE user_id IN (SELECT id FROM government_user WHERE agency_id = ANY($1::uuid[]))',
        [agencyIds],
      ],
      [
        'user_session',
        'DELETE FROM user_session WHERE government_user_id IN (SELECT id FROM government_user WHERE agency_id = ANY($1::uuid[]))',
        [agencyIds],
      ],
      [
        'government_user',
        'DELETE FROM government_user WHERE agency_id = ANY($1::uuid[])',
        [agencyIds],
      ],
      [
        'agency_compartment_grant',
        'DELETE FROM agency_compartment_grant WHERE agency_id = ANY($1::uuid[])',
        [agencyIds],
      ],
      ['agency', 'DELETE FROM agency WHERE id = ANY($1::uuid[])', [agencyIds]],
    ] as const) {
      const rows = await runner.query<{ count: string }>(
        `WITH deleted AS (${sql} RETURNING 1) SELECT count(*)::text AS count FROM deleted`,
        params as readonly unknown[],
      );
      results[label] = Number(rows[0]?.count ?? 0);
    }
    return results;
  });
  Object.assign(removed, counts);
  // The PCID allocations stay. They are append-only by design and by trigger:
  // an identifier issued once is never issued again, even a synthetic one.
  return removed;
}
