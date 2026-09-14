import type { Classification } from '@pcid/contracts';

export interface CitizenRow {
  id: string;
  pcid: string;
  status: string;
  given_name: string;
  middle_name: string | null;
  family_name: string;
  display_name: string;
  sex: string;
  date_of_birth: Date;
  phone_primary: string | null;
  phone_secondary: string | null;
  email: string | null;
  residential_address: string | null;
  lga_code: string | null;
  ward_code: string | null;
  community_code: string | null;
  photograph_uri: string | null;
  blood_group: string | null;
  emergency_medical_notes: string | null;
  nin: string | null;
  verification_level: string;
  classification: string;
  source_agency_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EmergencyContactRow {
  id: string;
  full_name: string;
  relationship: string;
  phone_primary: string;
  phone_secondary: string | null;
  priority: number;
  verification_status: string;
}

export interface LawEnforcementMarker {
  readonly kind: string;
  readonly reference: string;
  readonly status: string;
}

/**
 * Map a stored citizen row onto catalogue field paths.
 *
 * This is the only place the physical column names meet the catalogue, so adding
 * a column to `citizen` does not make it releasable: a field is releasable only
 * once it has a catalogue entry *and* an entry here.
 */
export function citizenFieldValues(
  row: CitizenRow,
  extras: {
    emergencyContacts?: readonly EmergencyContactRow[];
    identityIntegrityFlags?: readonly { reference: string; title: string; status: string }[];
    lawEnforcementMarkers?: readonly LawEnforcementMarker[];
  } = {},
): Record<string, unknown> {
  return {
    'citizen.pcid': row.pcid,
    'citizen.status': row.status,
    'citizen.displayName': row.display_name,
    'citizen.givenName': row.given_name,
    'citizen.middleName': row.middle_name,
    'citizen.familyName': row.family_name,
    'citizen.sex': row.sex,
    'citizen.dateOfBirth': row.date_of_birth.toISOString().slice(0, 10),
    'citizen.approximateAge': ageInYears(row.date_of_birth),
    'citizen.photographUri': row.photograph_uri,
    'citizen.phonePrimary': row.phone_primary,
    'citizen.phoneSecondary': row.phone_secondary,
    'citizen.email': row.email,
    'citizen.lgaCode': row.lga_code,
    'citizen.wardCode': row.ward_code,
    'citizen.registeredAddress': row.residential_address,
    'citizen.emergencyContacts': (extras.emergencyContacts ?? []).map((contact) => ({
      id: contact.id,
      fullName: contact.full_name,
      relationship: contact.relationship,
      phonePrimary: contact.phone_primary,
      phoneSecondary: contact.phone_secondary,
      priority: contact.priority,
      verificationStatus: contact.verification_status,
    })),
    'citizen.bloodGroup': row.blood_group,
    'citizen.emergencyMedicalNotes': row.emergency_medical_notes,
    'citizen.nin': row.nin,
    'citizen.verificationLevel': row.verification_level,
    'citizen.sourceAgencyId': row.source_agency_id,
    'citizen.identityIntegrityFlags': extras.identityIntegrityFlags ?? [],
    'citizen.lawEnforcementMarkers': extras.lawEnforcementMarkers ?? [],
  };
}

/**
 * Map a submitted registration onto catalogue field paths.
 *
 * A duplicate review compares somebody already on the register with somebody
 * standing at a desk, and the second of those has no citizen row yet. Putting
 * the application through the same paths means the reviewer sees the two people
 * described identically, and means the application is subject to the same field
 * release as the record - an applicant's date of birth is not less protected for
 * not having been accepted yet.
 */
export function applicantFieldValues(payload: Record<string, unknown>): Record<string, unknown> {
  const text = (key: string): string | null => {
    const value = payload[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  const dateOfBirth = text('dateOfBirth');
  const parsed = dateOfBirth === null ? null : new Date(`${dateOfBirth}T00:00:00Z`);
  return {
    'citizen.displayName': [text('givenName'), text('middleName'), text('familyName')]
      .filter((part): part is string => part !== null)
      .join(' '),
    'citizen.givenName': text('givenName'),
    'citizen.middleName': text('middleName'),
    'citizen.familyName': text('familyName'),
    'citizen.sex': text('sex'),
    'citizen.dateOfBirth': dateOfBirth,
    'citizen.approximateAge':
      parsed === null || Number.isNaN(parsed.getTime()) ? null : ageInYears(parsed),
    'citizen.phonePrimary': text('phonePrimary'),
    'citizen.phoneSecondary': text('phoneSecondary'),
    'citizen.email': text('email'),
    'citizen.lgaCode': text('lgaCode'),
    'citizen.wardCode': text('wardCode'),
    'citizen.registeredAddress': text('residentialAddress'),
    'citizen.nin': text('nin'),
  };
}

export function ageInYears(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

export function citizenClassification(row: CitizenRow): Classification {
  return row.classification as Classification;
}

/**
 * The columns a citizen row is read with, as a list.
 *
 * Kept as a list rather than a string so a query that needs them qualified or
 * aliased - joining two people into one row, for instance - can build that
 * without parsing SQL back apart.
 */
export const CITIZEN_COLUMN_LIST = [
  'id',
  'pcid',
  'status',
  'given_name',
  'middle_name',
  'family_name',
  'display_name',
  'sex',
  'date_of_birth',
  'phone_primary',
  'phone_secondary',
  'email',
  'residential_address',
  'lga_code',
  'ward_code',
  'community_code',
  'photograph_uri',
  'blood_group',
  'emergency_medical_notes',
  'nin',
  'verification_level',
  'classification',
  'source_agency_id',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof CitizenRow)[];

export const CITIZEN_COLUMNS = CITIZEN_COLUMN_LIST.join(', ');

/** The same columns, qualified and aliased, for a query that joins two people. */
export function citizenColumnsAliased(table: string, prefix: string): string {
  return CITIZEN_COLUMN_LIST.map((column) => `${table}.${column} AS ${prefix}_${column}`).join(
    ', ',
  );
}

/** Rebuild a citizen row from a result row whose columns carry that prefix. */
export function citizenRowFromPrefixed(row: Record<string, unknown>, prefix: string): CitizenRow {
  const rebuilt: Record<string, unknown> = {};
  for (const column of CITIZEN_COLUMN_LIST) rebuilt[column] = row[`${prefix}_${column}`];
  return rebuilt as unknown as CitizenRow;
}
