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

export const CITIZEN_COLUMNS = `
  id, pcid, status, given_name, middle_name, family_name, display_name, sex, date_of_birth,
  phone_primary, phone_secondary, email, residential_address, lga_code, ward_code, community_code,
  photograph_uri, blood_group, emergency_medical_notes, nin, verification_level, classification,
  source_agency_id, created_at, updated_at
`;
