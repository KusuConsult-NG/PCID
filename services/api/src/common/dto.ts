import {
  AGENCY_CATEGORIES,
  CASE_SUBJECT_ROLES,
  CASE_TYPES,
  CLASSIFICATIONS,
  DISPATCH_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  MISSING_PERSON_STATUSES,
  PURPOSES,
  REGISTRATION_CHANNELS,
  RESOURCE_TYPES,
  RESPONSE_UNIT_STATUSES,
  SEXES,
  UNIDENTIFIED_PERSON_CONDITIONS,
} from '@pcid/contracts';
import { z } from 'zod';

/** Shared primitives. Every DTO in the API is built from these. */
export const pcidSchema = z.string().min(10).max(32);
export const uuidSchema = z.string().uuid();
export const referenceSchema = z.string().min(3).max(64);
export const purposeSchema = z.enum(PURPOSES as unknown as [string, ...string[]]);
export const classificationSchema = z.enum(CLASSIFICATIONS as unknown as [string, ...string[]]);
export const resourceTypeSchema = z.enum(RESOURCE_TYPES as unknown as [string, ...string[]]);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * References that carry authority: the case, incident or break-glass grant an
 * access is being made under (§22, §23, §24). They are ordinary query parameters
 * so that a caller cannot reach a record without stating which authority applies.
 */
export const accessReferencesSchema = z.object({
  caseRef: referenceSchema.optional(),
  incidentRef: referenceSchema.optional(),
  breakGlassRef: referenceSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(256),
});

export const citizenLoginSchema = z.object({
  identifier: z.string().min(3).max(320),
  password: z.string().min(1).max(256),
});

export const mfaVerifySchema = z.object({
  sessionId: uuidSchema,
  code: z.string().min(4).max(32),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(16).max(512) });

export const citizenSearchSchema = paginationSchema.extend({
  purpose: purposeSchema,
  pcid: pcidSchema.optional(),
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(24).optional(),
  dateOfBirth: z.string().date().optional(),
  lgaCode: z.string().max(16).optional(),
  wardCode: z.string().max(24).optional(),
  caseRef: referenceSchema.optional(),
  incidentRef: referenceSchema.optional(),
  breakGlassRef: referenceSchema.optional(),
});

export const citizenViewQuerySchema = accessReferencesSchema.extend({ purpose: purposeSchema });

export const registrationSchema = z.object({
  givenName: z.string().min(1).max(100),
  middleName: z.string().max(100).nullish(),
  familyName: z.string().min(1).max(100),
  sex: z.enum(SEXES as unknown as [string, ...string[]]),
  dateOfBirth: z.string().date(),
  phonePrimary: z.string().min(6).max(24).nullish(),
  phoneSecondary: z.string().min(6).max(24).nullish(),
  email: z.string().email().max(320).nullish(),
  residentialAddress: z.string().max(400).nullish(),
  lgaCode: z.string().max(16).nullish(),
  wardCode: z.string().max(24).nullish(),
  communityCode: z.string().max(32).nullish(),
  channel: z.enum(REGISTRATION_CHANNELS as unknown as [string, ...string[]]),
  nin: z.string().min(8).max(32).nullish(),
});

export const duplicateReviewSchema = z.object({
  decision: z.enum(['CONFIRMED_DUPLICATE', 'DISTINCT_PERSON']),
  note: z.string().min(5).max(2000),
});

export const emergencyContactSchema = z.object({
  fullName: z.string().min(1).max(200),
  relationship: z.string().min(1).max(64),
  phonePrimary: z.string().min(6).max(24),
  phoneSecondary: z.string().min(6).max(24).nullish(),
  priority: z.number().int().min(1).max(5).default(1),
});

export const correctionRequestSchema = z.object({
  fieldPath: z.string().min(3).max(120),
  requestedValue: z.string().min(1).max(400),
  justification: z.string().min(5).max(2000),
  evidenceReference: z.string().max(200).nullish(),
});

export const createIncidentSchema = z.object({
  type: z.enum(INCIDENT_TYPES as unknown as [string, ...string[]]),
  severity: z.enum(INCIDENT_SEVERITIES as unknown as [string, ...string[]]).default('MEDIUM'),
  description: z.string().min(5).max(4000),
  addressText: z.string().max(400).nullish(),
  lgaCode: z.string().max(16).nullish(),
  wardCode: z.string().max(24).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  reporterContact: z.string().max(64).nullish(),
  leadAgencyId: uuidSchema.nullish(),
});

export const incidentStatusSchema = z.object({
  status: z.enum(INCIDENT_STATUSES as unknown as [string, ...string[]]),
  note: z.string().max(2000).nullish(),
});

export const incidentPersonSchema = z.object({
  citizenPcid: pcidSchema.nullish(),
  unidentifiedPersonId: uuidSchema.nullish(),
  role: z.enum(['CASUALTY', 'WITNESS', 'REPORTER', 'RESPONDER', 'NEXT_OF_KIN', 'SUBJECT', 'OTHER']),
  note: z.string().max(1000).nullish(),
});

export const dispatchSchema = z.object({
  unitCode: z.string().min(2).max(32),
  note: z.string().max(1000).nullish(),
});

export const dispatchStatusSchema = z.object({
  status: z.enum(DISPATCH_STATUSES as unknown as [string, ...string[]]),
  note: z.string().max(1000).nullish(),
});

export const unitPositionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const createCaseSchema = z.object({
  type: z.enum(CASE_TYPES as unknown as [string, ...string[]]),
  title: z.string().min(3).max(300),
  summary: z.string().max(4000).nullish(),
  classification: classificationSchema.optional(),
  lgaCode: z.string().max(16).nullish(),
  wardCode: z.string().max(24).nullish(),
  incidentId: uuidSchema.nullish(),
});

export const caseLinkSubjectSchema = z.object({
  subjectType: z.enum(['CITIZEN', 'VEHICLE', 'PROPERTY', 'BUSINESS']),
  subjectId: z.string().min(1).max(64),
  subjectRole: z.enum(CASE_SUBJECT_ROLES as unknown as [string, ...string[]]),
  justification: z.string().min(10).max(2000),
});

export const caseAssignSchema = z.object({
  userId: uuidSchema,
  role: z.enum(['INVESTIGATOR', 'SUPERVISOR', 'ANALYST', 'OBSERVER']).default('INVESTIGATOR'),
});

export const caseCloseSchema = z.object({ closureNote: z.string().min(5).max(4000) });

export const createMissingPersonSchema = z.object({
  fullName: z.string().min(2).max(200),
  citizenPcid: pcidSchema.nullish(),
  ageYears: z.number().int().min(0).max(130).nullish(),
  sex: z.enum(SEXES as unknown as [string, ...string[]]).nullish(),
  photographUri: z.string().max(500).nullish(),
  physicalDescription: z.string().max(2000).nullish(),
  clothingDescription: z.string().max(2000).nullish(),
  distinguishingFeatures: z.string().max(2000).nullish(),
  lastSeenAddress: z.string().max(400).nullish(),
  lastSeenLgaCode: z.string().max(16).nullish(),
  lastSeenWardCode: z.string().max(24).nullish(),
  lastSeenAt: z.string().datetime().nullish(),
  circumstances: z.string().max(4000).nullish(),
  reporterName: z.string().max(200).nullish(),
  reporterPhone: z.string().max(24).nullish(),
  reporterRelationship: z.string().max(64).nullish(),
  caseId: uuidSchema.nullish(),
});

export const createUnidentifiedPersonSchema = z.object({
  condition: z.enum(UNIDENTIFIED_PERSON_CONDITIONS as unknown as [string, ...string[]]),
  estimatedAgeMin: z.number().int().min(0).max(130).nullish(),
  estimatedAgeMax: z.number().int().min(0).max(130).nullish(),
  apparentSex: z.enum(SEXES as unknown as [string, ...string[]]).nullish(),
  photographUri: z.string().max(500).nullish(),
  physicalDescription: z.string().max(2000).nullish(),
  clothingDescription: z.string().max(2000).nullish(),
  distinguishingFeatures: z.string().max(2000).nullish(),
  identityClues: z.string().max(2000).nullish(),
  foundAddress: z.string().max(400).nullish(),
  foundLgaCode: z.string().max(16).nullish(),
  foundWardCode: z.string().max(24).nullish(),
  incidentId: uuidSchema.nullish(),
  externalBiometricReference: z.string().max(200).nullish(),
  biometricCustodianAgencyId: uuidSchema.nullish(),
});

export const matchReviewSchema = z.object({
  decision: z.enum(['CONFIRMED', 'REJECTED']),
  note: z.string().min(5).max(2000),
});

export const missingPersonResolveSchema = z.object({
  status: z.enum(['LOCATED', 'REUNITED', 'CLOSED', 'CANCELLED']),
  note: z.string().min(5).max(2000),
});

export const accessRequestSchema = z.object({
  purpose: purposeSchema,
  resourceType: resourceTypeSchema,
  subjectPcid: pcidSchema.nullish(),
  resourceId: z.string().max(64).nullish(),
  caseRef: referenceSchema.nullish(),
  incidentRef: referenceSchema.nullish(),
  requestedFields: z.array(z.string().min(3).max(120)).min(1).max(40),
  justification: z.string().min(10).max(2000),
});

export const accessDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  approvedFields: z.array(z.string().min(3).max(120)).max(40).optional(),
  note: z.string().min(5).max(2000),
  ttlSeconds: z.number().int().min(60).max(604_800).optional(),
});

export const breakGlassSchema = z.object({
  resourceType: resourceTypeSchema,
  subjectPcid: pcidSchema.nullish(),
  incidentRef: referenceSchema.nullish(),
  caseRef: referenceSchema.nullish(),
  gates: z
    .array(z.enum(['JURISDICTION', 'CASE_BINDING', 'INCIDENT_BINDING', 'FIELD_APPROVAL']))
    .min(1)
    .max(4),
  reason: z.string().min(20).max(2000),
  ttlSeconds: z.number().int().min(60).max(3600).optional(),
});

export const breakGlassReviewSchema = z.object({
  decision: z.enum(['REVIEWED_JUSTIFIED', 'REVIEWED_UNJUSTIFIED']),
  note: z.string().min(5).max(2000),
});

/* --- Oversight: correction review and alert review (§7, §32, §66) --------- */

export const correctionQueueSchema = paginationSchema.extend({
  status: z
    .enum(['SUBMITTED', 'EVIDENCE_REQUIRED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'APPLIED'])
    .optional(),
  subjectPcid: pcidSchema.optional(),
});

export const correctionDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_EVIDENCE']),
  note: z.string().min(5).max(2000),
});

export const alertQueueSchema = paginationSchema.extend({
  status: z
    .enum(['OPEN', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED_FALSE_POSITIVE', 'CLOSED'])
    .optional(),
  category: z.string().max(32).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
});

export const alertReviewSchema = z.object({
  decision: z.enum(['ACTIONED', 'DISMISSED_FALSE_POSITIVE', 'CLOSED']),
  note: z.string().min(5).max(2000),
});

export const duplicateQueueSchema = paginationSchema.extend({
  status: z
    .enum(['PENDING_REVIEW', 'CONFIRMED_DUPLICATE', 'DISTINCT_PERSON', 'MERGED'])
    .default('PENDING_REVIEW'),
});

export const userQueueSchema = paginationSchema.extend({
  agencyId: uuidSchema.optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'LOCKED', 'DISABLED']).optional(),
});

export const auditSearchSchema = paginationSchema.extend({
  actorId: uuidSchema.optional(),
  agencyId: uuidSchema.optional(),
  subjectPcid: pcidSchema.optional(),
  action: z.string().max(64).optional(),
  outcome: z.enum(['PERMITTED', 'DENIED', 'ERROR']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  breakGlassOnly: z.coerce.boolean().optional(),
});

export const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  lgaCode: z.string().max(16).optional(),
});

export const incidentListSchema = paginationSchema.extend({
  status: z.enum(INCIDENT_STATUSES as unknown as [string, ...string[]]).optional(),
  type: z.enum(INCIDENT_TYPES as unknown as [string, ...string[]]).optional(),
  lgaCode: z.string().max(16).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

export const unitListSchema = z.object({
  status: z.enum(RESPONSE_UNIT_STATUSES as unknown as [string, ...string[]]).optional(),
  agencyId: uuidSchema.optional(),
  lgaCode: z.string().max(16).optional(),
  nearIncident: referenceSchema.optional(),
});

export const caseListSchema = paginationSchema.extend({
  status: z.string().max(32).optional(),
  type: z.enum(CASE_TYPES as unknown as [string, ...string[]]).optional(),
});

export const missingPersonListSchema = paginationSchema.extend({
  status: z.enum(MISSING_PERSON_STATUSES as unknown as [string, ...string[]]).optional(),
  openOnly: z.coerce.boolean().optional(),
  lgaCode: z.string().max(16).optional(),
});

export const vehicleSearchSchema = accessReferencesSchema.extend({
  purpose: purposeSchema,
  registrationNumber: z.string().min(2).max(32),
});

export const propertySearchSchema = accessReferencesSchema.extend({
  purpose: purposeSchema,
  propertyId: z.string().max(64).optional(),
  address: z.string().max(200).optional(),
  lgaCode: z.string().max(16).optional(),
});

export const agencySchema = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2).max(200),
  category: z.enum(AGENCY_CATEGORIES as unknown as [string, ...string[]]),
  jurisdictionScope: z.enum(['STATE', 'LGA', 'WARD']).default('STATE'),
  jurisdictionLgaCodes: z.array(z.string().max(16)).default([]),
  jurisdictionWardCodes: z.array(z.string().max(24)).default([]),
  maxClassification: classificationSchema.default('INTERNAL'),
  contactEmail: z.string().email().max(320).nullish(),
  contactPhone: z.string().max(32).nullish(),
  dataProtectionOfficer: z.string().max(200).nullish(),
  administratorName: z.string().max(200).nullish(),
});

export const agencyStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
  dataSharingAgreement: z.enum(['SIGNED', 'PENDING', 'EXPIRED', 'SUSPENDED', 'NONE']).optional(),
  dataSharingExpiresAt: z.string().datetime().nullish(),
  apiIntegrationStatus: z
    .enum(['NOT_INTEGRATED', 'SANDBOX', 'CERTIFYING', 'LIVE', 'SUSPENDED'])
    .optional(),
});

export const verifySchema = z.object({ pcid: pcidSchema });

/* --- Citizen portal (§17, §39, §40, §58) ---------------------------------- */

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(14).max(256),
});

export const confirmCodeSchema = z.object({ code: z.string().min(4).max(16) });

export const credentialRevokeSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const verifyCredentialSchema = z.object({
  token: z.string().min(16).max(256),
});

export const emergencyRequestSchema = z.object({
  type: z.enum(INCIDENT_TYPES as unknown as [string, ...string[]]).default('MEDICAL_EMERGENCY'),
  description: z.string().min(5).max(2000),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  contactPhone: z.string().max(24).nullish(),
});

export const citizenReportSchema = z.object({
  description: z.string().min(10).max(4000),
  accessReference: z.string().max(128).nullish(),
});
