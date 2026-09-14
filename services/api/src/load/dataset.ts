import { generatePcid } from '@pcid/contracts';
import type { RandomSource } from '@pcid/contracts';

import { LOAD_PHONE_PREFIX } from './personas';
import { SeededRandom } from './random';

/**
 * Synthetic population for the load harness (§81 load testing).
 *
 * The numbers a load test produces are only as honest as the data underneath
 * them, and the shape that matters here is the *name distribution*: the registry
 * is searched through trigram indexes, and a trigram index over ten thousand
 * copies of one surname behaves nothing like one over a real population. So the
 * pools below are drawn from the language groups of Plateau State - Berom, Ngas,
 * Tarok, Mwaghavul, Afizere, Hausa, Igbo, Yoruba - and combined with a skew, so a
 * few surnames are common and most are not, which is how a register really looks.
 *
 * None of it is a real person. Every record is machine-generated from a seeded
 * pseudo-random source, the addresses are street names with generated numbers,
 * and the phone numbers sit in a block that no Nigerian operator issues.
 */

const FAMILY_NAMES = [
  'Dung',
  'Choji',
  'Gyang',
  'Dalyop',
  'Bature',
  'Pam',
  'Davou',
  'Chuwang',
  'Mangut',
  'Danjuma',
  'Bitrus',
  'Dashe',
  'Nanpon',
  'Jatau',
  'Yakubu',
  'Audu',
  'Musa',
  'Ibrahim',
  'Sule',
  'Adamu',
  'Okoro',
  'Nwachukwu',
  'Eze',
  'Okafor',
  'Adeyemi',
  'Oyelaran',
  'Bamidele',
  'Lar',
  'Tongdel',
  'Pwajok',
  'Gwom',
  'Vongjen',
  'Kyenpia',
  'Longkat',
  'Dakup',
  'Wuyep',
  'Zang',
  'Bulus',
  'Rwang',
  'Nden',
  'Kwanchi',
  'Maitumbi',
  'Gotom',
  'Selzing',
  'Damulak',
  'Shetima',
  'Useni',
  'Ponfa',
] as const;

const GIVEN_NAMES_FEMALE = [
  'Amina',
  'Rahila',
  'Ladi',
  'Nanle',
  'Talatu',
  'Grace',
  'Rifkatu',
  'Saratu',
  'Naomi',
  'Esther',
  'Hauwa',
  'Blessing',
  'Deborah',
  'Chinyere',
  'Folake',
  'Comfort',
  'Kande',
  'Mercy',
  'Rejoice',
  'Plangnan',
  'Mwantiri',
  'Nanbol',
  'Jummai',
  'Hannatu',
  'Lydia',
  'Victoria',
  'Patience',
] as const;

const GIVEN_NAMES_MALE = [
  'Dachung',
  'Gyang',
  'Musa',
  'Emmanuel',
  'Nanmwa',
  'Yohanna',
  'Ishaya',
  'Peter',
  'Solomon',
  'Bulus',
  'Danladi',
  'Joshua',
  'Chidi',
  'Tunde',
  'Ezekiel',
  'Samuel',
  'Istifanus',
  'Panle',
  'Monday',
  'Sunday',
  'Friday',
  'Markus',
  'Simon',
  'Bitrus',
  'Daniel',
  'Habila',
  'Auwal',
] as const;

const MIDDLE_NAMES = [
  'Ladi',
  'Nanle',
  'Panle',
  'Dung',
  'Choji',
  'John',
  'Mary',
  'Maryamu',
  'Nanret',
  'Kim',
  'Rwang',
  'Jonah',
  'Titus',
  'Nengak',
  'Yop',
  'Tali',
  'Kefas',
] as const;

const STREETS = [
  'Rwang Pam Street',
  'Murtala Mohammed Way',
  'Yakubu Gowon Way',
  'Bauchi Road',
  'Zaria Road',
  'Rukuba Road',
  'Ahmadu Bello Way',
  'Dogon Dutse Road',
  'Tudun Wada Road',
  'Farin Gada Road',
  'Bukuru Express Way',
  'Old Airport Road',
  'Laranto Road',
  'Angwan Rukuba Road',
  'Katako Road',
  'Naraguta Avenue',
  'Beach Road',
  'Secretariat Road',
  'Mission Road',
  'Kabong Road',
] as const;

const INCIDENT_TYPES = [
  'MEDICAL_EMERGENCY',
  'FIRE',
  'ROAD_ACCIDENT',
  'SECURITY_INCIDENT',
  'PUBLIC_DISTURBANCE',
  'FLOOD',
  'BUILDING_COLLAPSE',
  'RESCUE_OPERATION',
  'DISASTER',
  'OTHER',
] as const;

const INCIDENT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

/**
 * Weighted towards the closed end. A control room's board shows the live ones,
 * and a board that is mostly live is a state of emergency, not a normal Tuesday.
 */
const INCIDENT_STATUSES = [
  { value: 'CLOSED', weight: 55 },
  { value: 'RESOLVED', weight: 20 },
  { value: 'CONTAINED', weight: 7 },
  { value: 'ON_SCENE', weight: 6 },
  { value: 'DISPATCHED', weight: 5 },
  { value: 'VERIFIED', weight: 4 },
  { value: 'REPORTED', weight: 3 },
] as const;

const CASE_TYPES = [
  'CRIMINAL_INVESTIGATION',
  'MISSING_PERSON',
  'FRAUD',
  'IDENTITY_FRAUD',
  'PUBLIC_SAFETY',
  'OTHER',
] as const;

const CASE_STATUSES = [
  { value: 'CLOSED', weight: 45 },
  { value: 'ACTIVE', weight: 25 },
  { value: 'OPEN', weight: 15 },
  { value: 'PENDING_REVIEW', weight: 8 },
  { value: 'SUSPENDED', weight: 4 },
  { value: 'ARCHIVED', weight: 3 },
] as const;

/** Plateau State's rough bounding box, so generated coordinates land in the state. */
export const PLATEAU_BOUNDS = {
  minLatitude: 8.35,
  maxLatitude: 10.45,
  minLongitude: 8.45,
  maxLongitude: 10.55,
} as const;

export interface GeneratedCitizen {
  readonly pcid: string;
  readonly givenName: string;
  readonly middleName: string | null;
  readonly familyName: string;
  readonly displayName: string;
  readonly sex: 'FEMALE' | 'MALE' | 'UNSPECIFIED';
  readonly dateOfBirth: string;
  readonly phonePrimary: string;
  readonly email: string | null;
  readonly residentialAddress: string;
  readonly lgaCode: string;
  readonly wardCode: string;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DECEASED';
  readonly verificationLevel: string;
}

export interface GeneratedIncident {
  readonly type: string;
  readonly severity: string;
  readonly status: string;
  readonly description: string;
  readonly addressText: string;
  readonly lgaCode: string;
  readonly wardCode: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly reportedAt: Date;
}

export interface GeneratedCase {
  readonly type: string;
  readonly status: string;
  readonly title: string;
  readonly summary: string;
  readonly lgaCode: string;
}

export interface WardReference {
  readonly code: string;
  readonly lgaCode: string;
}

/**
 * Deterministic generators over a seeded source. Each takes an index so a caller
 * can generate batch 40 without generating batches 0 to 39 first.
 */
export class Dataset {
  private readonly random: SeededRandom;
  private readonly wardsByLga = new Map<string, WardReference[]>();

  constructor(
    seed: number,
    private readonly wards: readonly WardReference[],
  ) {
    this.random = new SeededRandom(seed);
    if (wards.length === 0) {
      throw new Error('The reference geography is empty. Run the reference data seed first.');
    }
    for (const ward of wards) {
      const list = this.wardsByLga.get(ward.lgaCode);
      if (list === undefined) this.wardsByLga.set(ward.lgaCode, [ward]);
      else list.push(ward);
    }
  }

  private place(): WardReference {
    // Jos North and Jos South hold most of the state's population, and the
    // skew puts most records there rather than spreading them evenly - which is
    // what makes an LGA-filtered query a realistic query.
    const ward = this.wards[this.random.skewed(0, this.wards.length - 1, 1.7)];
    return ward as WardReference;
  }

  citizen(pcidSource: RandomSource): GeneratedCitizen {
    const sex = this.random.chance(0.5) ? 'FEMALE' : 'MALE';
    const given = this.random.pick(sex === 'FEMALE' ? GIVEN_NAMES_FEMALE : GIVEN_NAMES_MALE);
    // Skewed, so a handful of surnames carry a lot of rows: a trigram index over
    // a uniform distribution is an easier index than the one production has.
    const family = FAMILY_NAMES[this.random.skewed(0, FAMILY_NAMES.length - 1, 1.6)] as string;
    const middle = this.random.chance(0.6) ? this.random.pick(MIDDLE_NAMES) : null;
    const ward = this.place();
    const birthYear = 1935 + this.random.skewed(0, 72, 0.8);
    const month = this.random.int(1, 12);
    const day = this.random.int(1, 28);
    const displayName = [given, middle, family].filter((part) => part !== null).join(' ');

    return {
      pcid: generatePcid(pcidSource),
      givenName: given,
      middleName: middle,
      familyName: family,
      displayName,
      sex,
      dateOfBirth: `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      phonePrimary: `${LOAD_PHONE_PREFIX}${String(this.random.int(0, 9_999_999)).padStart(7, '0')}`,
      email: this.random.chance(0.35)
        ? `${given.toLowerCase()}.${family.toLowerCase()}${this.random.int(1, 9999)}@example.invalid`
        : null,
      residentialAddress: `${this.random.int(1, 240)} ${this.random.pick(STREETS)}`,
      lgaCode: ward.lgaCode,
      wardCode: ward.code,
      status: this.random.chance(0.97)
        ? 'ACTIVE'
        : this.random.chance(0.6)
          ? 'DECEASED'
          : 'SUSPENDED',
      verificationLevel: this.random.chance(0.55)
        ? 'DOCUMENT_VERIFIED'
        : this.random.chance(0.5)
          ? 'AGENCY_VERIFIED'
          : 'SELF_ASSERTED',
    };
  }

  incident(now: number, spanDays: number): GeneratedIncident {
    const ward = this.place();
    const type = this.random.pick(INCIDENT_TYPES);
    const status = weighted(INCIDENT_STATUSES, this.random.next());
    // Recent incidents are more numerous in the window a control room looks at,
    // so the board query has something to page through.
    const ageMs = Math.pow(this.random.next(), 1.8) * spanDays * 86_400_000;
    const positioned = this.random.chance(0.62);
    return {
      type,
      severity: INCIDENT_SEVERITIES[this.random.skewed(0, 3, 0.7)] as string,
      status,
      description: `${type.replace(/_/g, ' ').toLowerCase()} reported at ${this.random.pick(STREETS)}`,
      addressText: `${this.random.int(1, 240)} ${this.random.pick(STREETS)}`,
      lgaCode: ward.lgaCode,
      wardCode: ward.code,
      latitude: positioned ? this.coordinate('latitude') : null,
      longitude: positioned ? this.coordinate('longitude') : null,
      reportedAt: new Date(now - ageMs),
    };
  }

  investigationCase(): GeneratedCase {
    const ward = this.place();
    const type = this.random.pick(CASE_TYPES);
    return {
      type,
      status: weighted(CASE_STATUSES, this.random.next()),
      title: `${type.replace(/_/g, ' ').toLowerCase()} at ${this.random.pick(STREETS)}`,
      summary: 'Generated for load measurement. No real enquiry is described here.',
      lgaCode: ward.lgaCode,
    };
  }

  private coordinate(axis: 'latitude' | 'longitude'): number {
    const min = axis === 'latitude' ? PLATEAU_BOUNDS.minLatitude : PLATEAU_BOUNDS.minLongitude;
    const max = axis === 'latitude' ? PLATEAU_BOUNDS.maxLatitude : PLATEAU_BOUNDS.maxLongitude;
    return Number((min + this.random.next() * (max - min)).toFixed(6));
  }

  /** Exposed so the seeder can make its own choices with the same sequence. */
  get source(): SeededRandom {
    return this.random;
  }
}

function weighted(
  items: readonly { readonly value: string; readonly weight: number }[],
  roll: number,
): string {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = roll * total;
  for (const item of items) {
    target -= item.weight;
    if (target < 0) return item.value;
  }
  return items[items.length - 1]?.value as string;
}

/** The name pools, exported so a test can assert the population is varied. */
export const NAME_POOLS = { FAMILY_NAMES, GIVEN_NAMES_FEMALE, GIVEN_NAMES_MALE } as const;
