/**
 * What the load harness creates, described without reaching for the database.
 *
 * Split from the seeder so the harness's own tests can assert the shape of a run
 * - the desks, the accounts, the manifest - without loading the API's injectable
 * services and the decorator metadata they carry.
 */
export const LOAD_CHANNEL = 'LOAD_TEST';
export const LOAD_AGENCY_PREFIX = 'PLT-LOAD';
export const LOAD_EMAIL_DOMAIN = 'load.plateaustate.gov.ng';
/**
 * Every telephone number the harness generates starts here. 0700 is not
 * allocated to any Nigerian mobile operator, so nothing it writes can reach a
 * handset - and it doubles as the marker for rows a run created through the
 * registration endpoint, which by design carry an ordinary channel.
 */
export const LOAD_PHONE_PREFIX = '0700';

export interface LoadPersona {
  readonly key: string;
  readonly roles: readonly string[];
  readonly clearance: string;
  readonly agencyCode: string;
  readonly agencyName: string;
  readonly agencyCategory: string;
  readonly agencyMaxClassification: string;
  readonly lawEnforcementCompartment: boolean;
}

/**
 * The four desks that generate the platform's traffic. One account per virtual
 * user is created for each, because a load test run through a handful of shared
 * logins measures the per-account rate limiter rather than the platform.
 */
export const LOAD_PERSONAS: readonly LoadPersona[] = Object.freeze([
  {
    key: 'counter',
    roles: ['MDA_OFFICER'],
    clearance: 'CONFIDENTIAL',
    agencyCode: `${LOAD_AGENCY_PREFIX}-MDA`,
    agencyName: 'Plateau State Service Delivery Desks (load)',
    agencyCategory: 'MDA',
    agencyMaxClassification: 'CONFIDENTIAL',
    lawEnforcementCompartment: false,
  },
  {
    key: 'registrar',
    roles: ['REGISTRATION_OFFICER'],
    clearance: 'HIGHLY_RESTRICTED',
    agencyCode: `${LOAD_AGENCY_PREFIX}-REGISTRY`,
    agencyName: 'Plateau State Citizen Registry (load)',
    agencyCategory: 'MDA',
    agencyMaxClassification: 'HIGHLY_RESTRICTED',
    lawEnforcementCompartment: false,
  },
  {
    key: 'dispatcher',
    roles: ['DISPATCHER', 'INCIDENT_OFFICER'],
    clearance: 'HIGHLY_RESTRICTED',
    agencyCode: `${LOAD_AGENCY_PREFIX}-EMS`,
    agencyName: 'Plateau State Emergency Control (load)',
    agencyCategory: 'EMERGENCY',
    agencyMaxClassification: 'HIGHLY_RESTRICTED',
    lawEnforcementCompartment: false,
  },
  {
    key: 'investigator',
    roles: ['INVESTIGATOR'],
    clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    agencyCode: `${LOAD_AGENCY_PREFIX}-POLICE`,
    agencyName: 'Plateau State Command (load)',
    agencyCategory: 'SECURITY',
    agencyMaxClassification: 'LAW_ENFORCEMENT_RESTRICTED',
    lawEnforcementCompartment: true,
  },
]);

export interface LoadAccount {
  readonly persona: string;
  readonly email: string;
  readonly password: string;
  readonly totpSecret: string;
  readonly roles: readonly string[];
}

export interface LoadManifest {
  readonly generatedAt: string;
  readonly seed: number;
  readonly counts: {
    readonly citizens: number;
    readonly incidents: number;
    readonly cases: number;
    readonly auditEvents: number;
  };
  readonly accounts: readonly LoadAccount[];
  /** A sample the driver reads from, so requests name records that exist. */
  readonly samples: {
    readonly pcids: readonly string[];
    /**
     * Whole people, not just names: at four million records a name is not an
     * identifier, and a counter search carries the date of birth the person in
     * front of the officer has just told them.
     */
    readonly people: readonly {
      readonly name: string;
      readonly dateOfBirth: string;
      readonly lgaCode: string | null;
    }[];
    readonly familyNames: readonly string[];
    readonly incidentNumbers: readonly string[];
    readonly caseNumbers: readonly string[];
    readonly lgaCodes: readonly string[];
  };
}
