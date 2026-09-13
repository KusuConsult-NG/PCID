import { z } from 'zod';

/**
 * The agreed record shapes for each integrated domain (master system prompt §54).
 *
 * These are the contract with each source agency. Anything an upstream returns is
 * parsed against them before it can enter the platform's projection, and the
 * schemas strip unknown keys rather than passing them through.
 */
const provenance = z.object({
  sourceRecordId: z.string().min(1),
  sourceUpdatedAt: z.string().datetime().nullable().default(null),
});

export const vehicleSourceSchema = provenance.extend({
  registrationNumber: z.string().min(2).max(32),
  make: z.string().max(64).nullable().default(null),
  model: z.string().max(64).nullable().default(null),
  colour: z.string().max(32).nullable().default(null),
  registrationStatus: z.enum(['CURRENT', 'EXPIRED', 'REVOKED', 'UNKNOWN']).default('UNKNOWN'),
  alertStatus: z.enum(['NONE', 'REPORTED_STOLEN', 'WANTED', 'IMPOUNDED']).nullable().default(null),
  alertReference: z.string().max(64).nullable().default(null),
  ownerPcid: z.string().nullable().default(null),
  ownerName: z.string().max(200).nullable().default(null),
  ownerContact: z.string().max(64).nullable().default(null),
});
export type VehicleSource = z.infer<typeof vehicleSourceSchema>;

export const propertySourceSchema = provenance.extend({
  propertyId: z.string().min(1).max(64),
  address: z.string().min(1).max(400),
  lgaCode: z.string().max(16).nullable().default(null),
  wardCode: z.string().max(24).nullable().default(null),
  useType: z
    .enum(['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'])
    .default('RESIDENTIAL'),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  emergencyAccessNotes: z.string().max(1000).nullable().default(null),
  occupantCountEstimate: z.number().int().nonnegative().nullable().default(null),
  ownerPcid: z.string().nullable().default(null),
  ownerName: z.string().max(200).nullable().default(null),
});
export type PropertySource = z.infer<typeof propertySourceSchema>;

export const businessSourceSchema = provenance.extend({
  businessId: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  status: z.enum(['ACTIVE', 'DORMANT', 'REVOKED', 'UNKNOWN']).default('UNKNOWN'),
  address: z.string().max(400).nullable().default(null),
  lgaCode: z.string().max(16).nullable().default(null),
  proprietorPcid: z.string().nullable().default(null),
});
export type BusinessSource = z.infer<typeof businessSourceSchema>;

export const licenceSourceSchema = provenance.extend({
  licenceId: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  status: z.enum(['CURRENT', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'UNKNOWN']).default('UNKNOWN'),
  validFrom: z.string().date().nullable().default(null),
  validTo: z.string().date().nullable().default(null),
  holderPcid: z.string().nullable().default(null),
});
export type LicenceSource = z.infer<typeof licenceSourceSchema>;

export const revenueSourceSchema = provenance.extend({
  taxpayerId: z.string().min(1).max(64),
  citizenPcid: z.string().nullable().default(null),
  complianceStatus: z
    .enum(['COMPLIANT', 'ARREARS', 'UNDER_ASSESSMENT', 'UNKNOWN'])
    .default('UNKNOWN'),
  outstandingBalanceMinor: z.number().int().default(0),
});
export type RevenueSource = z.infer<typeof revenueSourceSchema>;
