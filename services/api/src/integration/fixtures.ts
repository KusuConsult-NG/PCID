import type { SourceRecord } from './adapter';
import type {
  BusinessSource,
  LicenceSource,
  PropertySource,
  RevenueSource,
  VehicleSource,
} from './schemas';

/**
 * Development fixtures for the sandbox adapters.
 *
 * These are obviously synthetic - the names are placeholders and the identifiers
 * are outside any real allocation - and the sandbox adapter refuses to load in a
 * production process, so they cannot be mistaken for agency data (§77).
 */
export function vehicleFixtures(
  agencyId: string,
  system: string,
  pcids: readonly string[],
): readonly SourceRecord<VehicleSource>[] {
  return pcids.slice(0, 3).map((pcid, index) => ({
    data: {
      sourceRecordId: `VEH-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 0, 10 + index)).toISOString(),
      registrationNumber: `PLT-${100 + index}-SBX`,
      make: ['Toyota', 'Nissan', 'Peugeot'][index] ?? 'Toyota',
      model: ['Hilux', 'Urvan', '406'][index] ?? 'Hilux',
      colour: ['White', 'Blue', 'Silver'][index] ?? 'White',
      registrationStatus: 'CURRENT' as const,
      alertStatus: index === 2 ? ('REPORTED_STOLEN' as const) : ('NONE' as const),
      alertReference: index === 2 ? 'SBX-ALERT-001' : null,
      ownerPcid: pcid,
      ownerName: null,
      ownerContact: `080000000${index}`,
    },
    provenance: {
      sourceAgencyId: agencyId,
      sourceSystem: system,
      sourceRecordId: `VEH-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 0, 10 + index)).toISOString(),
      verificationStatus: 'SOURCE_CONFIRMED' as const,
    },
  }));
}

export function propertyFixtures(
  agencyId: string,
  system: string,
  pcids: readonly string[],
): readonly SourceRecord<PropertySource>[] {
  return pcids.slice(0, 3).map((pcid, index) => ({
    data: {
      sourceRecordId: `PRP-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 0, 5 + index)).toISOString(),
      propertyId: `PL/JN/${2000 + index}`,
      address: `${index + 1} Sandbox Close, Jos`,
      lgaCode: 'PL-JNO',
      wardCode: 'PL-JNO-01',
      useType: 'RESIDENTIAL' as const,
      latitude: 9.8965 + index * 0.001,
      longitude: 8.8583 + index * 0.001,
      emergencyAccessNotes:
        index === 0 ? 'Gated compound; hydrant at the junction 40m north.' : null,
      occupantCountEstimate: 4 + index,
      ownerPcid: pcid,
      ownerName: null,
    },
    provenance: {
      sourceAgencyId: agencyId,
      sourceSystem: system,
      sourceRecordId: `PRP-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 0, 5 + index)).toISOString(),
      verificationStatus: 'SOURCE_CONFIRMED' as const,
    },
  }));
}

export function businessFixtures(
  agencyId: string,
  system: string,
  pcids: readonly string[],
): readonly SourceRecord<BusinessSource>[] {
  return pcids.slice(0, 2).map((pcid, index) => ({
    data: {
      sourceRecordId: `BUS-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 1, 1 + index)).toISOString(),
      businessId: `PLB-${5000 + index}`,
      name: `Sandbox Trading Enterprise ${index + 1}`,
      status: 'ACTIVE' as const,
      address: `${index + 10} Market Road, Jos`,
      lgaCode: 'PL-JNO',
      proprietorPcid: pcid,
    },
    provenance: {
      sourceAgencyId: agencyId,
      sourceSystem: system,
      sourceRecordId: `BUS-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 1, 1 + index)).toISOString(),
      verificationStatus: 'SOURCE_CONFIRMED' as const,
    },
  }));
}

export function licenceFixtures(
  agencyId: string,
  system: string,
  pcids: readonly string[],
): readonly SourceRecord<LicenceSource>[] {
  return pcids.slice(0, 2).map((pcid, index) => ({
    data: {
      sourceRecordId: `LIC-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 1, 10 + index)).toISOString(),
      licenceId: `PLL-${7000 + index}`,
      type: index === 0 ? 'DRIVING_LICENCE' : 'TRADE_PERMIT',
      status: 'CURRENT' as const,
      validFrom: '2025-01-01',
      validTo: '2029-12-31',
      holderPcid: pcid,
    },
    provenance: {
      sourceAgencyId: agencyId,
      sourceSystem: system,
      sourceRecordId: `LIC-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 1, 10 + index)).toISOString(),
      verificationStatus: 'SOURCE_CONFIRMED' as const,
    },
  }));
}

export function revenueFixtures(
  agencyId: string,
  system: string,
  pcids: readonly string[],
): readonly SourceRecord<RevenueSource>[] {
  return pcids.slice(0, 3).map((pcid, index) => ({
    data: {
      sourceRecordId: `REV-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 1, 20 + index)).toISOString(),
      taxpayerId: `PLT-TAX-${9000 + index}`,
      citizenPcid: pcid,
      complianceStatus: index === 1 ? ('ARREARS' as const) : ('COMPLIANT' as const),
      outstandingBalanceMinor: index === 1 ? 4_250_00 : 0,
    },
    provenance: {
      sourceAgencyId: agencyId,
      sourceSystem: system,
      sourceRecordId: `REV-SANDBOX-${index + 1}`,
      sourceUpdatedAt: new Date(Date.UTC(2026, 1, 20 + index)).toISOString(),
      verificationStatus: 'SOURCE_CONFIRMED' as const,
    },
  }));
}
