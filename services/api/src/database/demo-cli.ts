/**
 * Stand up a working development environment.
 *
 * Creates the agencies, officers and one resident that the portal and the
 * end-to-end tests need, so a developer can sign in and see a populated portal
 * within a minute of cloning.
 *
 * Refuses to run in production. The data it creates is obviously synthetic and
 * is written through the same registration, duplicate-detection and audit paths
 * as anything else - there is no back door here, only a script that uses the
 * platform the way an operator would (§77, §78).
 */
import { randomBytes } from 'node:crypto';

import { loadEnv } from '../config/env';
import { bootstrapPlatformAdministrator } from './bootstrap';
import { Database } from './pool';
import { seedReferenceData } from './seed';

const ADMIN_EMAIL = 'platform.admin@pcid.plateaustate.gov.ng';
const ADMIN_PASSWORD = 'Bootstrap-Passphrase-2026!';

interface DemoOfficer {
  readonly email: string;
  readonly fullName: string;
  readonly agencyCode: string;
  readonly roles: readonly string[];
  readonly clearance: string;
}

const AGENCIES = [
  {
    code: 'PLT-REGISTRY',
    name: 'Plateau State Citizen Registry',
    category: 'MDA',
    max: 'HIGHLY_RESTRICTED',
    compartment: false,
  },
  {
    code: 'PLT-REVENUE',
    name: 'Plateau State Internal Revenue Service',
    category: 'REVENUE',
    max: 'CONFIDENTIAL',
    compartment: false,
  },
  {
    code: 'PLT-LANDS',
    name: 'Plateau State Lands Registry',
    category: 'LANDS',
    max: 'CONFIDENTIAL',
    compartment: false,
  },
  {
    code: 'PLT-POLICE',
    name: 'Plateau State Police Command',
    category: 'SECURITY',
    max: 'LAW_ENFORCEMENT_RESTRICTED',
    compartment: true,
  },
  {
    code: 'PLT-EMS',
    name: 'Plateau State Emergency Management Agency',
    category: 'EMERGENCY',
    max: 'HIGHLY_RESTRICTED',
    compartment: false,
  },
] as const;

const OFFICERS: readonly DemoOfficer[] = [
  {
    email: 'registrar@demo.plateaustate.gov.ng',
    fullName: 'Registration Desk',
    agencyCode: 'PLT-REGISTRY',
    roles: ['REGISTRATION_OFFICER'],
    clearance: 'HIGHLY_RESTRICTED',
  },
  {
    email: 'counter@demo.plateaustate.gov.ng',
    fullName: 'Service Counter',
    agencyCode: 'PLT-REVENUE',
    roles: ['VERIFICATION_OFFICER', 'REVENUE_OFFICER'],
    clearance: 'CONFIDENTIAL',
  },
  {
    email: 'dispatcher@demo.plateaustate.gov.ng',
    fullName: 'Emergency Control',
    agencyCode: 'PLT-EMS',
    roles: ['DISPATCHER', 'INCIDENT_OFFICER'],
    clearance: 'HIGHLY_RESTRICTED',
  },
  {
    email: 'dpo@demo.plateaustate.gov.ng',
    fullName: 'Data Protection Office',
    agencyCode: 'PLT-REGISTRY',
    roles: ['DATA_PROTECTION_OFFICER', 'AUDITOR'],
    clearance: 'HIGHLY_RESTRICTED',
  },
  {
    email: 'investigator@demo.plateaustate.gov.ng',
    fullName: 'Case Officer',
    agencyCode: 'PLT-POLICE',
    roles: ['INVESTIGATOR'],
    clearance: 'LAW_ENFORCEMENT_RESTRICTED',
  },
  {
    email: 'commander@demo.plateaustate.gov.ng',
    fullName: 'Command Supervisor',
    agencyCode: 'PLT-POLICE',
    roles: ['SUPERVISOR'],
    clearance: 'LAW_ENFORCEMENT_RESTRICTED',
  },
  {
    email: 'missing@demo.plateaustate.gov.ng',
    fullName: 'Missing Persons Desk',
    agencyCode: 'PLT-POLICE',
    roles: ['MISSING_PERSON_OFFICER'],
    clearance: 'LAW_ENFORCEMENT_RESTRICTED',
  },
];

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('The demo environment must never be created in production.');
  }

  // `--json` exists so the end-to-end suite can provision itself through the
  // same path a developer uses, rather than keeping a second seed that could
  // drift away from this one.
  const asJson = process.argv.includes('--json');

  const baseUrl = process.env.PCID_API_URL ?? `http://127.0.0.1:${env.PORT}`;
  const db = new Database(env);

  try {
    const bootstrap = await db.transaction(async (runner) => {
      await seedReferenceData(runner);
      return bootstrapPlatformAdministrator(runner, env, {
        agencyCode: 'PLT-PLATFORM',
        agencyName: 'Plateau State PCID Platform Office',
        email: ADMIN_EMAIL,
        fullName: 'Platform Administrator',
        password: ADMIN_PASSWORD,
      });
    });

    if (!bootstrap.created) {
      if (asJson) {
        throw new Error(
          'The demo environment already exists. Point DATABASE_URL at an empty database.',
        );
      }
      process.stdout.write('The demo environment already exists; nothing was changed.\n');
      return;
    }
    if (bootstrap.totpSecret === null) throw new Error('bootstrap returned no authenticator');

    const api = new DemoApi(baseUrl);
    const adminToken = await api.signIn(ADMIN_EMAIL, ADMIN_PASSWORD, bootstrap.totpSecret);

    const agencyIds = new Map<string, string>();
    for (const agency of AGENCIES) {
      const created = await api.post<{ id: string }>(adminToken, '/api/v1/agencies', {
        code: agency.code,
        name: agency.name,
        category: agency.category,
        jurisdictionScope: 'STATE',
        jurisdictionLgaCodes: [],
        jurisdictionWardCodes: [],
        maxClassification: agency.max,
      });
      agencyIds.set(agency.code, created.id);
      await api.patch(adminToken, `/api/v1/agencies/${created.id}/status`, {
        status: 'ACTIVE',
        dataSharingAgreement: 'SIGNED',
        apiIntegrationStatus: 'LIVE',
      });
      if (agency.compartment) {
        await api.post(adminToken, `/api/v1/agencies/${created.id}/compartments/law-enforcement`, {
          legalBasis:
            'Demonstration environment: approved for authorised law-enforcement processing.',
        });
      }
    }

    const officerPasswords = new Map<string, string>();
    const officerAuthenticators = new Map<string, string>();
    for (const officer of OFFICERS) {
      const password = `Zq7${randomBytes(12).toString('base64url')}Xm4`;
      const created = await api.post<{ id: string; totpSecret: string }>(
        adminToken,
        '/api/v1/users',
        {
          email: officer.email,
          fullName: officer.fullName,
          agencyId: agencyIds.get(officer.agencyCode),
          roles: [...officer.roles],
          clearance: officer.clearance,
          jurisdictionScope: 'STATE',
          jurisdictionLgaCodes: [],
          jurisdictionWardCodes: [],
          temporaryPassword: password,
        },
      );
      officerPasswords.set(officer.email, password);
      officerAuthenticators.set(officer.email, created.totpSecret);
      // Confirm the authenticator so the account is usable straight away.
      await db.transaction(async (runner) => {
        await runner.query(
          `UPDATE mfa_credential SET confirmed_at = now()
            WHERE user_id = $1 AND kind = 'TOTP' AND confirmed_at IS NULL`,
          [created.id],
        );
        await runner.query('UPDATE government_user SET mfa_enrolled = true WHERE id = $1', [
          created.id,
        ]);
      });
      process.env[`DEMO_TOTP_${officer.email}`] = created.totpSecret;
    }

    const registrar = OFFICERS[0] as DemoOfficer;
    const registrarToken = await api.signInWithStoredSecret(
      registrar.email,
      officerPasswords.get(registrar.email) as string,
    );

    const registration = await api.post<{ pcid: string }>(registrarToken, '/api/v1/citizens', {
      givenName: 'Amina',
      middleName: 'Ladi',
      familyName: 'Dung',
      sex: 'FEMALE',
      dateOfBirth: '1994-06-12',
      phonePrimary: '08030000001',
      email: 'amina.dung@example.ng',
      residentialAddress: '12 Rwang Pam Street, Jos',
      lgaCode: 'PL-JNO',
      wardCode: 'PL-JNO-01',
      channel: 'REGISTRATION_DESK',
    });

    const portal = await api.post<{ pcid: string; temporaryPassword: string }>(
      registrarToken,
      `/api/v1/citizens/${registration.pcid}/portal-account`,
      undefined,
    );

    // Something for the resident to look at: a linked property and vehicle.
    const landsSource = await api.post<{ id: string }>(adminToken, '/api/v1/integrations', {
      agencyId: agencyIds.get('PLT-LANDS'),
      domain: 'LANDS',
      systemName: 'Lands Registry Core',
      adapterKey: 'lands-sandbox',
      mode: 'SANDBOX',
      config: { samplePcids: [registration.pcid] },
    });
    await api.post(adminToken, `/api/v1/integrations/${landsSource.id}/sync`, undefined);

    const revenueSource = await api.post<{ id: string }>(adminToken, '/api/v1/integrations', {
      agencyId: agencyIds.get('PLT-REVENUE'),
      domain: 'REVENUE',
      systemName: 'Revenue Assessment System',
      adapterKey: 'revenue-sandbox',
      mode: 'SANDBOX',
      config: { samplePcids: [registration.pcid] },
    });
    await api.post(adminToken, `/api/v1/integrations/${revenueSource.id}/sync`, undefined);

    // Something for the security portal to show: an open case with the officer
    // on it, a live missing-person enquiry, and somebody found who cannot say
    // who they are. All through the ordinary routes, so the demo exercises the
    // same authorisation as anybody else.
    const investigatorToken = await api.signInWithStoredSecret(
      'investigator@demo.plateaustate.gov.ng',
      officerPasswords.get('investigator@demo.plateaustate.gov.ng') as string,
    );
    const openedCase = await api.post<{ caseNumber: string }>(investigatorToken, '/api/v1/cases', {
      type: 'CRIMINAL_INVESTIGATION',
      title: 'Warehouse burglary, Terminus market',
      summary: 'Rear shutter forced overnight. Two witnesses named.',
      lgaCode: 'PL-JNO',
    });
    await api.patch(investigatorToken, `/api/v1/cases/${openedCase.caseNumber}`, {
      status: 'ACTIVE',
    });
    await api.post(investigatorToken, `/api/v1/cases/${openedCase.caseNumber}/notes`, {
      body: 'Attended the scene at 07:40. Statements taken from the two witnesses.',
    });

    const missingOfficerToken = await api.signInWithStoredSecret(
      'missing@demo.plateaustate.gov.ng',
      officerPasswords.get('missing@demo.plateaustate.gov.ng') as string,
    );
    const missingPerson = await api.post<{ caseReference: string }>(
      missingOfficerToken,
      '/api/v1/missing-persons',
      {
        fullName: 'Rahila Choji',
        ageYears: 16,
        sex: 'FEMALE',
        circumstances: 'Did not return from school on Tuesday afternoon.',
        lastSeenAddress: 'Rukuba Road, Jos',
        lastSeenLgaCode: 'PL-JNO',
        physicalDescription: 'About 1.6m, plaited hair, green school uniform.',
        reporterName: 'Mrs Choji',
        reporterRelationship: 'Mother',
        reporterPhone: '08035550001',
      },
    );
    await api.post(
      missingOfficerToken,
      `/api/v1/missing-persons/${missingPerson.caseReference}/sightings`,
      {
        description:
          'A caller reports a girl matching the description near the Rukuba Road junction.',
        addressText: 'Rukuba Road junction',
        lgaCode: 'PL-JNO',
        reporterName: 'Passer-by',
      },
    );
    await api.post(missingOfficerToken, '/api/v1/unidentified-persons', {
      condition: 'UNCONSCIOUS',
      estimatedAgeMin: 60,
      estimatedAgeMax: 75,
      apparentSex: 'MALE',
      physicalDescription: 'Elderly man, grey beard, no identification on him.',
      clothingDescription: 'Brown kaftan.',
      foundAddress: 'Bukuru junction',
      foundLgaCode: 'PL-JSO',
    });

    // A message waiting in the portal inbox.
    await db.query(
      `INSERT INTO notification (channel, recipient_type, recipient_id, subject, body, classification)
       VALUES ('IN_APP','CITIZEN',$1,'Welcome to the Plateau Citizen Portal',
               'Your portal account is ready. Please choose your own passphrase and add an emergency contact.',
               'INTERNAL')`,
      [registration.pcid],
    );

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            citizen: { pcid: portal.pcid, temporaryPassword: portal.temporaryPassword },
            administrator: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
            officers: OFFICERS.map((officer) => ({
              email: officer.email,
              password: officerPasswords.get(officer.email) ?? null,
              totpSecret: officerAuthenticators.get(officer.email) ?? null,
              roles: officer.roles,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(
      [
        '',
        'Demo environment ready.',
        '',
        '  Citizen portal sign-in',
        `    Plateau Citizen ID: ${portal.pcid}`,
        `    Passphrase:         ${portal.temporaryPassword}`,
        '    (The portal will ask you to choose your own on first sign-in.)',
        '',
        '  Platform administrator',
        `    Email:      ${ADMIN_EMAIL}`,
        `    Passphrase: ${ADMIN_PASSWORD}`,
        '',
        '  Officers (passphrase, then authenticator secret)',
        ...OFFICERS.flatMap((officer) => [
          `    ${officer.email}`,
          `      passphrase:    ${officerPasswords.get(officer.email) ?? ''}`,
          `      authenticator: ${officerAuthenticators.get(officer.email) ?? ''}`,
        ]),
        '',
        'This data is synthetic and this command refuses to run in production.',
        '',
      ].join('\n'),
    );
  } finally {
    await db.onModuleDestroy();
  }
}

/** A very small API client, so the demo uses the same paths a real operator does. */
class DemoApi {
  private readonly secrets = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async signIn(email: string, password: string, totpSecret: string): Promise<string> {
    this.secrets.set(email, totpSecret);
    return this.signInWithStoredSecret(email, password);
  }

  async signInWithStoredSecret(email: string, password: string): Promise<string> {
    const login = await this.request<{ accessToken: string }>(null, 'POST', '/api/v1/auth/login', {
      email,
      password,
    });
    const sessionId = JSON.parse(
      Buffer.from(login.accessToken.split('.')[1] as string, 'base64url').toString('utf8'),
    ).sid as string;

    const secret = this.secrets.get(email) ?? process.env[`DEMO_TOTP_${email}`];
    if (secret === undefined) throw new Error(`No authenticator secret recorded for ${email}`);

    const { TotpService } = await import('../security/totp.service');
    const totp = new TotpService();
    const verified = await this.request<{ accessToken: string }>(
      null,
      'POST',
      '/api/v1/auth/mfa/verify',
      {
        sessionId,
        code: totp.generate(secret),
      },
    );
    return verified.accessToken;
  }

  post<T>(token: string, path: string, body: unknown): Promise<T> {
    return this.request<T>(token, 'POST', path, body);
  }

  patch<T>(token: string, path: string, body: unknown): Promise<T> {
    return this.request<T>(token, 'PATCH', path, body);
  }

  private async request<T>(
    token: string | null,
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
    }
    return (text === '' ? null : JSON.parse(text)) as T;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
