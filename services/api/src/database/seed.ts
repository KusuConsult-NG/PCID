import { PLATEAU_LGAS, ROLE_DEFINITIONS } from '@pcid/contracts';

import type { QueryRunner } from './pool';

/**
 * Reference and policy seed data (master system prompt §41).
 *
 * Idempotent and safe to re-run on every deployment: roles and their action
 * grants are reconciled to the declarations in `@pcid/contracts`, so a role that
 * gains an action in code gains it in the database on the next deploy, and one
 * that loses an action loses it - the database does not silently keep a grant the
 * codebase has removed.
 */
export async function seedReferenceData(runner: QueryRunner): Promise<void> {
  for (const lga of PLATEAU_LGAS) {
    await runner.query(
      `INSERT INTO lga (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [lga.code, lga.name],
    );
    // Three wards per LGA as a starting structure; the real ward list is loaded
    // from the State Independent Electoral Commission's reference data.
    for (let index = 1; index <= 3; index += 1) {
      const code = `${lga.code}-${String(index).padStart(2, '0')}`;
      await runner.query(
        `INSERT INTO ward (code, lga_code, name) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
        [code, lga.code, `${lga.name} Ward ${index}`],
      );
    }
  }

  for (const role of ROLE_DEFINITIONS) {
    const row = await runner.queryOne<{ id: string }>(
      `INSERT INTO role (name, description, technical_only, system_managed)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (name) DO UPDATE
         SET description = EXCLUDED.description, technical_only = EXCLUDED.technical_only
       RETURNING id`,
      [role.name, role.description, role.technicalOnly === true],
    );
    if (row === null) throw new Error(`role upsert returned no row for ${role.name}`);

    for (const action of role.actions) {
      await runner.query(
        'INSERT INTO role_action (role_id, action) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [row.id, action],
      );
    }
    // Remove grants the declaration no longer contains.
    await runner.query(
      'DELETE FROM role_action WHERE role_id = $1 AND NOT (action = ANY($2::text[]))',
      [row.id, [...role.actions]],
    );
  }

  await seedAlertRules(runner);
}

async function seedAlertRules(runner: QueryRunner): Promise<void> {
  const rules = [
    {
      key: 'duplicate-identity-attributes',
      kind: 'DUPLICATE_IDENTITY_ATTRIBUTES',
      name: 'Identity Integrity Alert',
      description:
        'A registration request shares identifying attributes with an existing registry record.',
      category: 'IDENTITY_INTEGRITY',
      severity: 'MEDIUM',
      parameters: { reviewThreshold: 60, strongThreshold: 85 },
      notifyRoles: ['REGISTRATION_OFFICER', 'DATA_PROTECTION_OFFICER'],
      notifyChannels: ['IN_APP', 'DASHBOARD'],
    },
    {
      key: 'repeated-failed-admin-access',
      kind: 'REPEATED_FAILED_ADMIN_ACCESS',
      name: 'Security Alert',
      description: 'Repeated failed attempts to reach an administrative function.',
      category: 'SECURITY',
      severity: 'HIGH',
      parameters: { threshold: 5, windowSeconds: 900 },
      notifyRoles: ['PLATFORM_ADMINISTRATOR', 'SECURITY_ADMINISTRATOR'],
      notifyChannels: ['EMAIL', 'DASHBOARD'],
    },
    {
      key: 'unusual-bulk-export',
      kind: 'UNUSUAL_BULK_EXPORT',
      name: 'Data Security Alert',
      description: 'An export larger than the agency norm was requested.',
      category: 'DATA_SECURITY',
      severity: 'HIGH',
      parameters: { recordThreshold: 500, windowSeconds: 3600 },
      notifyRoles: ['DATA_PROTECTION_OFFICER', 'AUDITOR'],
      notifyChannels: ['EMAIL', 'DASHBOARD'],
    },
    {
      key: 'unusual-search-volume',
      kind: 'UNUSUAL_SEARCH_VOLUME',
      name: 'Unusual search volume',
      description: 'An account performed an unusually large number of citizen searches.',
      category: 'SECURITY',
      severity: 'MEDIUM',
      parameters: { threshold: 60, windowSeconds: 3600 },
      notifyRoles: ['SUPERVISOR', 'AUDITOR'],
      notifyChannels: ['IN_APP', 'DASHBOARD'],
    },
    {
      key: 'missing-person-potential-match',
      kind: 'MISSING_PERSON_POTENTIAL_MATCH',
      name: 'Potential Match Alert',
      description:
        'An open missing-person case has a candidate match against an unidentified-person record.',
      category: 'POTENTIAL_MATCH',
      severity: 'HIGH',
      parameters: { candidateThreshold: 45 },
      notifyRoles: ['MISSING_PERSON_OFFICER', 'SUPERVISOR'],
      notifyChannels: ['IN_APP', 'SMS', 'DASHBOARD'],
    },
    {
      key: 'incident-response-unit-notification',
      kind: 'INCIDENT_RESPONSE_UNIT_NOTIFICATION',
      name: 'Incident notification',
      description: 'An incident was raised in an area a response unit covers.',
      category: 'EMERGENCY_DISPATCH',
      severity: 'INFO',
      parameters: { radiusMetres: 10000 },
      notifyRoles: ['DISPATCHER', 'INCIDENT_OFFICER'],
      notifyChannels: ['PUSH', 'DASHBOARD'],
    },
    {
      key: 'break-glass-initiated',
      kind: 'BREAK_GLASS_INITIATED',
      name: 'Break-glass access used',
      description: 'Emergency access was relied upon and requires a post-event review.',
      category: 'SECURITY',
      severity: 'HIGH',
      parameters: { reviewDueHours: 24 },
      notifyRoles: ['SUPERVISOR', 'DATA_PROTECTION_OFFICER', 'AUDITOR'],
      notifyChannels: ['EMAIL', 'DASHBOARD'],
    },
    {
      key: 'unauthorised-access-attempt',
      kind: 'UNAUTHORISED_ACCESS_ATTEMPT',
      name: 'Unauthorised access attempt',
      description: 'An account repeatedly attempted accesses the policy engine refused.',
      category: 'SECURITY',
      severity: 'HIGH',
      parameters: { threshold: 10, windowSeconds: 3600 },
      notifyRoles: ['SUPERVISOR', 'AUDITOR', 'DATA_PROTECTION_OFFICER'],
      notifyChannels: ['EMAIL', 'DASHBOARD'],
    },
  ];

  for (const rule of rules) {
    await runner.query(
      `INSERT INTO alert_rule (key, kind, name, description, category, severity, enabled,
                               parameters, notify_roles, notify_channels)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7::jsonb,$8,$9)
       ON CONFLICT (key) DO UPDATE
         SET kind = EXCLUDED.kind, name = EXCLUDED.name, description = EXCLUDED.description,
             category = EXCLUDED.category, severity = EXCLUDED.severity,
             parameters = EXCLUDED.parameters, notify_roles = EXCLUDED.notify_roles,
             notify_channels = EXCLUDED.notify_channels`,
      [
        rule.key,
        rule.kind,
        rule.name,
        rule.description,
        rule.category,
        rule.severity,
        JSON.stringify(rule.parameters),
        rule.notifyRoles,
        rule.notifyChannels,
      ],
    );
  }
}
