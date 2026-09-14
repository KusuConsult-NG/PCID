import { LOAD_PHONE_PREFIX } from './personas';
import type { SeededRandom } from './random';
import type { LoadManifest } from './volume';

/**
 * The request mix (§81 load testing).
 *
 * A load test is only as truthful as its mix. These scenarios are the calls the
 * four portals actually make, in roughly the proportion a working day produces:
 * mostly people being looked up at a counter, a steady background of the
 * emergency board refreshing itself, and a much smaller number of writes. A
 * benchmark that hammered one endpoint would produce a bigger number and tell us
 * nothing about whether the platform stands up.
 *
 * Every scenario states which HTTP statuses count as an answer rather than a
 * failure, because a refusal is a correct outcome here: a case-bound search
 * against a closed case is *supposed* to be refused, and a harness that scored it
 * as an error would report a broken platform and hide a real regression behind
 * the noise. The status distribution is printed in full either way.
 */

export interface LoadRequest {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly body?: unknown;
  /** Raise the session to AAL2 before issuing this request. */
  readonly requiresStepUp?: boolean;
}

export interface Workspace {
  /** Cases this account is assigned to, learnt at sign-in as an officer would. */
  caseNumbers: string[];
  /** Incidents seen on the board, so a view names one that exists. */
  incidentNumbers: string[];
  /** People this account has already found, so a view follows a search. */
  pcids: string[];
}

export interface ScenarioContext {
  readonly samples: LoadManifest['samples'];
  readonly random: SeededRandom;
  readonly workspace: Workspace;
}

export interface Scenario {
  readonly name: string;
  readonly persona: string;
  readonly weight: number;
  /** Statuses that count as an answer. Anything else is a failure. */
  readonly answers: readonly number[];
  build(context: ScenarioContext): LoadRequest | null;
}

const OK = [200, 201] as const;
/** A refusal is an answer: the platform decided, wrote the decision and said no. */
const OK_OR_REFUSED = [200, 201, 403, 404] as const;

function sample<T>(values: readonly T[], random: SeededRandom): T | null {
  if (values.length === 0) return null;
  return values[random.int(0, values.length - 1)] as T;
}

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  /* ---- The service counter. Most of the platform's traffic (§6, §20). ---- */
  {
    name: 'counter: search by name',
    persona: 'counter',
    weight: 26,
    answers: OK,
    // A name and a date of birth, because the person is standing at the counter
    // and has just said both. At four million records a name on its own is not
    // an identification and the platform refuses it; this is the request a
    // service desk really makes, and the most common one the platform serves.
    build: ({ samples, random }) => {
      const person = sample(samples.people, random);
      return person === null
        ? null
        : {
            method: 'GET',
            path:
              `/api/v1/citizens?purpose=SERVICE_DELIVERY&name=${encodeURIComponent(person.name)}` +
              `&dateOfBirth=${person.dateOfBirth}&limit=20`,
          };
    },
  },
  {
    name: 'counter: search too broadly',
    persona: 'counter',
    weight: 4,
    // A surname on its own against a statewide register matches a couple of
    // hundred thousand people, and the platform refuses rather than paging
    // through them. The refusal is the answer being measured: it has to be
    // cheap, because any officer can ask for it.
    answers: [400],
    build: ({ samples, random }) => {
      const name = sample(samples.familyNames, random);
      return name === null
        ? null
        : {
            method: 'GET',
            path: `/api/v1/citizens?purpose=SERVICE_DELIVERY&name=${encodeURIComponent(name)}&limit=20`,
          };
    },
  },
  {
    name: 'counter: search by PCID',
    persona: 'counter',
    weight: 10,
    answers: OK,
    build: ({ samples, random }) => {
      const pcid = sample(samples.pcids, random);
      return pcid === null
        ? null
        : {
            method: 'GET',
            path: `/api/v1/citizens?purpose=SERVICE_DELIVERY&pcid=${encodeURIComponent(pcid)}`,
          };
    },
  },
  {
    name: 'counter: view record',
    persona: 'counter',
    weight: 22,
    answers: OK_OR_REFUSED,
    build: ({ samples, random, workspace }) => {
      // Prefer somebody this account has just found: a view follows a search.
      const pcid = sample(workspace.pcids, random) ?? sample(samples.pcids, random);
      return pcid === null
        ? null
        : {
            method: 'GET',
            path: `/api/v1/citizens/${encodeURIComponent(pcid)}?purpose=SERVICE_DELIVERY`,
          };
    },
  },
  {
    name: 'counter: verify a presented PCID',
    persona: 'counter',
    weight: 8,
    answers: OK_OR_REFUSED,
    build: ({ samples, random }) => {
      const pcid = sample(samples.pcids, random);
      return pcid === null
        ? null
        : { method: 'POST', path: '/api/v1/verification/pcid', body: { pcid } };
    },
  },

  /* ---- The registration desk. Few requests, the heaviest each (§48). ---- */
  {
    name: 'registry: register a resident',
    persona: 'registrar',
    weight: 4,
    // A close match stops the registration and queues it for review. That is the
    // control working, and it answers 200 with a DUPLICATE_REVIEW outcome.
    answers: OK,
    build: ({ samples, random }) => {
      const lga = sample(samples.lgaCodes, random);
      const family = sample(samples.familyNames, random) ?? 'Dung';
      const serial = random.int(0, 9_999_999);
      return {
        method: 'POST',
        path: '/api/v1/citizens',
        body: {
          givenName: `Load${random.int(1000, 9999)}`,
          familyName: family,
          sex: random.chance(0.5) ? 'FEMALE' : 'MALE',
          dateOfBirth: `${1950 + random.int(0, 55)}-0${random.int(1, 9)}-1${random.int(0, 8)}`,
          phonePrimary: `${LOAD_PHONE_PREFIX}${String(serial).padStart(7, '0')}`,
          residentialAddress: `${random.int(1, 200)} Load Test Street`,
          lgaCode: lga,
          channel: 'REGISTRATION_DESK',
        },
      };
    },
  },
  {
    name: 'registry: duplicate queue',
    persona: 'registrar',
    weight: 3,
    answers: OK,
    build: () => ({ method: 'GET', path: '/api/v1/citizens/duplicates?limit=20' }),
  },

  /* ---- The control room. A board that refreshes itself all day (§8). ---- */
  {
    name: 'control: incident board',
    persona: 'dispatcher',
    weight: 12,
    answers: OK,
    build: () => ({ method: 'GET', path: '/api/v1/incidents?activeOnly=true&limit=25' }),
  },
  {
    name: 'control: view incident',
    persona: 'dispatcher',
    weight: 6,
    answers: OK_OR_REFUSED,
    build: ({ samples, random, workspace }) => {
      const reference =
        sample(workspace.incidentNumbers, random) ?? sample(samples.incidentNumbers, random);
      return reference === null ? null : { method: 'GET', path: `/api/v1/incidents/${reference}` };
    },
  },
  {
    name: 'control: command map',
    persona: 'dispatcher',
    weight: 5,
    answers: OK,
    // The whole state, which is the view a control room opens on.
    build: () => ({
      method: 'GET',
      path: '/api/v1/map/situation?north=10.45&south=8.35&east=10.55&west=8.45',
    }),
  },
  {
    name: 'control: available units',
    persona: 'dispatcher',
    weight: 3,
    answers: OK,
    build: () => ({ method: 'GET', path: '/api/v1/response-units?status=AVAILABLE' }),
  },
  {
    name: 'control: report an incident',
    persona: 'dispatcher',
    weight: 2,
    answers: OK,
    build: ({ samples, random }) => ({
      method: 'POST',
      path: '/api/v1/incidents',
      body: {
        type: 'ROAD_ACCIDENT',
        severity: random.chance(0.2) ? 'CRITICAL' : 'MEDIUM',
        description: 'Generated by the load harness for measurement.',
        addressText: `${random.int(1, 200)} Load Test Road`,
        lgaCode: sample(samples.lgaCodes, random),
        latitude: Number((8.5 + random.next() * 1.8).toFixed(6)),
        longitude: Number((8.6 + random.next() * 1.8).toFixed(6)),
        reporterContact: `${LOAD_PHONE_PREFIX}0000000`,
      },
    }),
  },

  /* ---- The investigation desk. Case-bound throughout (§22). ---- */
  {
    name: 'case: my caseload',
    persona: 'investigator',
    weight: 4,
    answers: OK,
    build: () => ({ method: 'GET', path: '/api/v1/cases?limit=20' }),
  },
  {
    name: 'case: view case file',
    persona: 'investigator',
    weight: 4,
    answers: OK_OR_REFUSED,
    build: ({ random, workspace }) => {
      const reference = sample(workspace.caseNumbers, random);
      return reference === null ? null : { method: 'GET', path: `/api/v1/cases/${reference}` };
    },
  },
  {
    name: 'case: search under a case',
    persona: 'investigator',
    weight: 3,
    answers: OK_OR_REFUSED,
    build: ({ samples, random, workspace }) => {
      const reference = sample(workspace.caseNumbers, random);
      const person = sample(samples.people, random);
      return reference === null || person === null
        ? null
        : {
            method: 'GET',
            path:
              `/api/v1/citizens?purpose=CRIMINAL_INVESTIGATION&caseRef=${reference}` +
              `&name=${encodeURIComponent(person.name)}&dateOfBirth=${person.dateOfBirth}&limit=20`,
          };
    },
  },

  /* ---- The one call that touches no data, as a floor to measure against. ---- */
  {
    name: 'platform: readiness probe',
    persona: 'counter',
    weight: 1,
    answers: OK,
    build: () => ({ method: 'GET', path: '/api/v1/health/ready' }),
  },
]);

/** The scenarios a given persona can drive. */
export function scenariosFor(persona: string): readonly Scenario[] {
  return SCENARIOS.filter((scenario) => scenario.persona === persona);
}

export interface Profile {
  readonly name: string;
  readonly description: string;
  /** How the virtual users are divided between the desks. Must sum to 1. */
  readonly mix: Readonly<Record<string, number>>;
}

/**
 * Two shapes of day.
 *
 * `counter` is an ordinary working morning: the registry is what is busy. `surge`
 * is the shape of a bad afternoon - a bus crash, a flood - where the control room
 * is generating most of the traffic and the counters carry on regardless. The
 * second is the one that matters: a platform that only stands up when nothing is
 * happening is not a public-safety platform.
 */
export const PROFILES: readonly Profile[] = Object.freeze([
  {
    name: 'counter',
    description: 'An ordinary working day: mostly service-counter lookups.',
    mix: { counter: 0.7, registrar: 0.1, dispatcher: 0.12, investigator: 0.08 },
  },
  {
    name: 'surge',
    description: 'A major incident: the control room carries most of the load.',
    mix: { counter: 0.35, registrar: 0.05, dispatcher: 0.5, investigator: 0.1 },
  },
]);

export function profileByName(name: string): Profile {
  const profile = PROFILES.find((candidate) => candidate.name === name);
  if (profile === undefined) {
    throw new Error(`Unknown profile "${name}". Known: ${PROFILES.map((p) => p.name).join(', ')}.`);
  }
  return profile;
}
