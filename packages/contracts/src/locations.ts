/** Reference geography (master system prompt §41, §48). */

export interface LgaReference {
  readonly code: string;
  readonly name: string;
}

/**
 * The seventeen Local Government Areas of Plateau State. Held as reference data in
 * the `lga` table; this constant seeds it and is never consulted at request time.
 */
export const PLATEAU_LGAS: readonly LgaReference[] = Object.freeze([
  { code: 'PL-BAR', name: 'Barkin Ladi' },
  { code: 'PL-BAS', name: 'Bassa' },
  { code: 'PL-BOK', name: 'Bokkos' },
  { code: 'PL-JEA', name: 'Jos East' },
  { code: 'PL-JNO', name: 'Jos North' },
  { code: 'PL-JSO', name: 'Jos South' },
  { code: 'PL-KAN', name: 'Kanam' },
  { code: 'PL-KAK', name: 'Kanke' },
  { code: 'PL-LAN', name: 'Langtang North' },
  { code: 'PL-LAS', name: 'Langtang South' },
  { code: 'PL-MAN', name: 'Mangu' },
  { code: 'PL-MIK', name: 'Mikang' },
  { code: 'PL-PAN', name: 'Pankshin' },
  { code: 'PL-QAA', name: "Qua'an Pan" },
  { code: 'PL-RIY', name: 'Riyom' },
  { code: 'PL-SHE', name: 'Shendam' },
  { code: 'PL-WAS', name: 'Wase' },
]);

/** Jurisdiction scope of a government user or agency (master system prompt §3). */
export const JURISDICTION_SCOPES = ['STATE', 'LGA', 'WARD'] as const;
export type JurisdictionScope = (typeof JURISDICTION_SCOPES)[number];

export interface Jurisdiction {
  readonly scope: JurisdictionScope;
  /** LGA codes in scope. Empty when `scope` is STATE. */
  readonly lgaCodes: readonly string[];
  /** Ward codes in scope. Empty unless `scope` is WARD. */
  readonly wardCodes: readonly string[];
}

export const STATEWIDE_JURISDICTION: Jurisdiction = Object.freeze({
  scope: 'STATE',
  lgaCodes: Object.freeze([]) as readonly string[],
  wardCodes: Object.freeze([]) as readonly string[],
});
