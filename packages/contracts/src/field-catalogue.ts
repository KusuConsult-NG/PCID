import type { Classification } from './classification';
import type { Purpose } from './purpose';
import type { ResourceType } from './resources';

/**
 * The field catalogue (master system prompt §27, §29, §38, §68).
 *
 * Every field the platform can release carries its own classification, the closed
 * set of purposes it may be released for, and whether release additionally needs
 * a supervisor approval or break-glass grant. The policy engine computes the
 * released field set from this catalogue; no module is permitted to hand back a
 * field that the catalogue has not cleared.
 *
 * This is the concrete expression of data minimisation: the default answer for
 * any field not listed here is "not released".
 */
export interface FieldDefinition {
  /** Dotted field path, e.g. `citizen.dateOfBirth`. */
  readonly field: string;
  readonly resourceType: ResourceType;
  readonly classification: Classification;
  /**
   * Purposes for which this field may be released. A field is never released for
   * a purpose outside this set, whatever the subject's clearance.
   */
  readonly purposes: readonly Purpose[];
  /** Release additionally requires an approved access request or a break-glass grant. */
  readonly requiresApproval?: boolean;
  /** Part of the Minimum Necessary Emergency Profile (§10, §38). */
  readonly emergencyProfile?: boolean;
  /** The citizen can see this field on their own record in the citizen portal. */
  readonly selfServiceVisible?: boolean;
  /** The citizen can edit this field themselves (§18). */
  readonly selfServiceEditable?: boolean;
  readonly description: string;
}

const ALL_SERVICE_PURPOSES: readonly Purpose[] = [
  'CITIZEN_SELF_SERVICE',
  'IDENTITY_VERIFICATION',
  'SERVICE_DELIVERY',
  'REVENUE_ADMINISTRATION',
  'EMERGENCY_RESPONSE',
  'EMERGENCY_IDENTIFICATION',
  'DISASTER_RESPONSE',
  'PUBLIC_HEALTH_RESPONSE',
  'MISSING_PERSON_INVESTIGATION',
  'CRIMINAL_INVESTIGATION',
  'IDENTITY_INTEGRITY_REVIEW',
  'CORRECTION_REVIEW',
];

const INVESTIGATIVE_AND_EMERGENCY: readonly Purpose[] = [
  'EMERGENCY_RESPONSE',
  'EMERGENCY_IDENTIFICATION',
  'DISASTER_RESPONSE',
  'MISSING_PERSON_INVESTIGATION',
  'CRIMINAL_INVESTIGATION',
];

const EMERGENCY_ONLY: readonly Purpose[] = [
  'EMERGENCY_RESPONSE',
  'EMERGENCY_IDENTIFICATION',
  'DISASTER_RESPONSE',
];

export const CITIZEN_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'citizen.pcid',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    emergencyProfile: true,
    selfServiceVisible: true,
    description: 'The Plateau Citizen ID itself.',
  },
  {
    field: 'citizen.status',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Registry status of the record (ACTIVE, SUSPENDED, DECEASED, MERGED).',
  },
  {
    field: 'citizen.displayName',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    emergencyProfile: true,
    selfServiceVisible: true,
    description: 'Full name as printed on the credential.',
  },
  {
    field: 'citizen.givenName',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Given name as recorded on the identity record.',
  },
  {
    field: 'citizen.middleName',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Middle name as recorded on the identity record.',
  },
  {
    field: 'citizen.familyName',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Family name as recorded on the identity record.',
  },
  {
    field: 'citizen.sex',
    resourceType: 'CITIZEN',
    classification: 'CONFIDENTIAL',
    purposes: ALL_SERVICE_PURPOSES,
    emergencyProfile: true,
    selfServiceVisible: true,
    description: 'Sex as recorded on the authoritative government record.',
  },
  {
    field: 'citizen.approximateAge',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    emergencyProfile: true,
    selfServiceVisible: true,
    description:
      'Age in years, derived. Released in place of the exact date of birth wherever age alone is sufficient.',
  },
  {
    field: 'citizen.dateOfBirth',
    resourceType: 'CITIZEN',
    classification: 'CONFIDENTIAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Exact date of birth.',
  },
  {
    field: 'citizen.photographUri',
    resourceType: 'CITIZEN',
    classification: 'SENSITIVE',
    purposes: [
      'CITIZEN_SELF_SERVICE',
      'IDENTITY_VERIFICATION',
      ...INVESTIGATIVE_AND_EMERGENCY,
      'CORRECTION_REVIEW',
    ],
    emergencyProfile: true,
    selfServiceVisible: true,
    description: 'Reference to the stored photograph. Never the image bytes themselves.',
  },
  {
    field: 'citizen.phonePrimary',
    resourceType: 'CITIZEN',
    classification: 'CONFIDENTIAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    selfServiceEditable: true,
    description: 'Primary telephone number.',
  },
  {
    field: 'citizen.phoneSecondary',
    resourceType: 'CITIZEN',
    classification: 'CONFIDENTIAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    selfServiceEditable: true,
    description: 'Secondary telephone number.',
  },
  {
    field: 'citizen.email',
    resourceType: 'CITIZEN',
    classification: 'CONFIDENTIAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    selfServiceEditable: true,
    description: 'Email address.',
  },
  {
    field: 'citizen.lgaCode',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    emergencyProfile: true,
    selfServiceVisible: true,
    description: 'Local Government Area of the registered address.',
  },
  {
    field: 'citizen.wardCode',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Electoral ward of the registered address.',
  },
  {
    field: 'citizen.registeredAddress',
    resourceType: 'CITIZEN',
    classification: 'SENSITIVE',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description:
      'Full registered address. This is where the government record says the person lives - it is not a location observation (§16).',
  },
  {
    field: 'citizen.emergencyContacts',
    resourceType: 'CITIZEN',
    classification: 'SENSITIVE',
    purposes: ['CITIZEN_SELF_SERVICE', ...INVESTIGATIVE_AND_EMERGENCY, 'PUBLIC_HEALTH_RESPONSE'],
    emergencyProfile: true,
    selfServiceVisible: true,
    selfServiceEditable: true,
    description: 'Emergency contacts nominated by the citizen.',
  },
  {
    field: 'citizen.bloodGroup',
    resourceType: 'CITIZEN',
    classification: 'HIGHLY_RESTRICTED',
    purposes: EMERGENCY_ONLY,
    emergencyProfile: true,
    selfServiceVisible: true,
    selfServiceEditable: true,
    description: 'Blood group, released only for emergency response.',
  },
  {
    field: 'citizen.emergencyMedicalNotes',
    resourceType: 'CITIZEN',
    classification: 'HIGHLY_RESTRICTED',
    purposes: EMERGENCY_ONLY,
    emergencyProfile: true,
    selfServiceVisible: true,
    selfServiceEditable: true,
    description:
      'Allergies and critical conditions the citizen has chosen to disclose for emergency care only.',
  },
  {
    field: 'citizen.nin',
    resourceType: 'CITIZEN',
    classification: 'HIGHLY_RESTRICTED',
    purposes: ['CITIZEN_SELF_SERVICE', 'IDENTITY_INTEGRITY_REVIEW', 'CORRECTION_REVIEW'],
    requiresApproval: true,
    selfServiceVisible: true,
    description:
      'Optional external national identifier, present only when an authoritative source supplied it. Never a prerequisite for a PCID (§2).',
  },
  {
    field: 'citizen.verificationLevel',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Assurance level of the identity record.',
  },
  {
    field: 'citizen.sourceAgencyId',
    resourceType: 'CITIZEN',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Agency that supplied or vouched for the record.',
  },
  {
    field: 'citizen.identityIntegrityFlags',
    resourceType: 'CITIZEN',
    classification: 'SENSITIVE',
    purposes: ['IDENTITY_INTEGRITY_REVIEW', 'CORRECTION_REVIEW', 'CRIMINAL_INVESTIGATION'],
    requiresApproval: true,
    description:
      'Open identity-integrity alerts. These describe record anomalies, never a person (§31, §65).',
  },
  {
    field: 'citizen.lawEnforcementMarkers',
    resourceType: 'CITIZEN',
    classification: 'LAW_ENFORCEMENT_RESTRICTED',
    purposes: ['CRIMINAL_INVESTIGATION', 'MISSING_PERSON_INVESTIGATION'],
    requiresApproval: true,
    description:
      'Markers placed by an authorised law-enforcement record, e.g. an active missing-person flag.',
  },
]);

export const VEHICLE_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'vehicle.registrationNumber',
    resourceType: 'VEHICLE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Vehicle registration number.',
  },
  {
    field: 'vehicle.make',
    resourceType: 'VEHICLE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Vehicle manufacturer as held by the transport authority.',
  },
  {
    field: 'vehicle.model',
    resourceType: 'VEHICLE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Vehicle model as held by the transport authority.',
  },
  {
    field: 'vehicle.colour',
    resourceType: 'VEHICLE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Vehicle colour as held by the transport authority.',
  },
  {
    field: 'vehicle.registrationStatus',
    resourceType: 'VEHICLE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Whether the registration is current, expired or revoked.',
  },
  {
    field: 'vehicle.alertStatus',
    resourceType: 'VEHICLE',
    classification: 'LAW_ENFORCEMENT_RESTRICTED',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description:
      'Stolen/wanted markers as supplied by the authoritative transport or police record.',
  },
  {
    field: 'vehicle.ownerPcid',
    resourceType: 'VEHICLE',
    classification: 'SENSITIVE',
    purposes: [
      'CITIZEN_SELF_SERVICE',
      'CRIMINAL_INVESTIGATION',
      'MISSING_PERSON_INVESTIGATION',
      'EMERGENCY_RESPONSE',
      'REVENUE_ADMINISTRATION',
    ],
    selfServiceVisible: true,
    description: 'PCID of the registered owner.',
  },
  {
    field: 'vehicle.ownerName',
    resourceType: 'VEHICLE',
    classification: 'SENSITIVE',
    purposes: ['CITIZEN_SELF_SERVICE', 'CRIMINAL_INVESTIGATION', 'MISSING_PERSON_INVESTIGATION'],
    selfServiceVisible: true,
    description: 'Name of the registered owner.',
  },
  {
    field: 'vehicle.ownerContact',
    resourceType: 'VEHICLE',
    classification: 'HIGHLY_RESTRICTED',
    purposes: ['CITIZEN_SELF_SERVICE', 'CRIMINAL_INVESTIGATION', 'MISSING_PERSON_INVESTIGATION'],
    requiresApproval: true,
    selfServiceVisible: true,
    description: 'Contact details of the registered owner. Restricted owner information (§14).',
  },
  {
    field: 'vehicle.sourceAgencyId',
    resourceType: 'VEHICLE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Authoritative source agency for this record (§28).',
  },
]);

export const PROPERTY_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'property.propertyId',
    resourceType: 'PROPERTY',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Property identifier held by the lands registry.',
  },
  {
    field: 'property.address',
    resourceType: 'PROPERTY',
    classification: 'CONFIDENTIAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Street address of the property as held by the lands registry.',
  },
  {
    field: 'property.lgaCode',
    resourceType: 'PROPERTY',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Local Government Area in which the property sits.',
  },
  {
    field: 'property.wardCode',
    resourceType: 'PROPERTY',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Electoral ward in which the property sits.',
  },
  {
    field: 'property.useType',
    resourceType: 'PROPERTY',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Residential, commercial, industrial or institutional use.',
  },
  {
    field: 'property.emergencyAccessNotes',
    resourceType: 'PROPERTY',
    classification: 'SENSITIVE',
    purposes: EMERGENCY_ONLY,
    emergencyProfile: true,
    description:
      'Access information relevant to fire, rescue and disaster response (hydrants, gates, hazards).',
  },
  {
    field: 'property.occupantCountEstimate',
    resourceType: 'PROPERTY',
    classification: 'SENSITIVE',
    purposes: EMERGENCY_ONLY,
    emergencyProfile: true,
    description: 'Estimated occupancy, used for rescue planning only.',
  },
  {
    field: 'property.ownerPcid',
    resourceType: 'PROPERTY',
    classification: 'SENSITIVE',
    purposes: [
      'CITIZEN_SELF_SERVICE',
      'REVENUE_ADMINISTRATION',
      'CRIMINAL_INVESTIGATION',
      'MISSING_PERSON_INVESTIGATION',
      'EMERGENCY_RESPONSE',
      'DISASTER_RESPONSE',
    ],
    selfServiceVisible: true,
    description: 'PCID of the registered owner or occupier.',
  },
  {
    field: 'property.ownerName',
    resourceType: 'PROPERTY',
    classification: 'SENSITIVE',
    purposes: [
      'CITIZEN_SELF_SERVICE',
      'REVENUE_ADMINISTRATION',
      'CRIMINAL_INVESTIGATION',
      'MISSING_PERSON_INVESTIGATION',
    ],
    selfServiceVisible: true,
    description: 'Name of the registered owner or occupier.',
  },
  {
    field: 'property.sourceAgencyId',
    resourceType: 'PROPERTY',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Authoritative source agency for this record (§28).',
  },
]);

export const REVENUE_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'revenue.taxpayerId',
    resourceType: 'REVENUE_PROFILE',
    classification: 'CONFIDENTIAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'REVENUE_ADMINISTRATION'],
    selfServiceVisible: true,
    description: 'Taxpayer identifier held by the revenue service.',
  },
  {
    field: 'revenue.complianceStatus',
    resourceType: 'REVENUE_PROFILE',
    classification: 'CONFIDENTIAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'REVENUE_ADMINISTRATION', 'SERVICE_DELIVERY'],
    selfServiceVisible: true,
    description: 'Whether the taxpayer is current on filings.',
  },
  {
    field: 'revenue.outstandingBalanceMinor',
    resourceType: 'REVENUE_PROFILE',
    classification: 'SENSITIVE',
    purposes: ['CITIZEN_SELF_SERVICE', 'REVENUE_ADMINISTRATION'],
    selfServiceVisible: true,
    description: 'Outstanding balance in kobo.',
  },
  {
    field: 'revenue.sourceAgencyId',
    resourceType: 'REVENUE_PROFILE',
    classification: 'INTERNAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'REVENUE_ADMINISTRATION', 'SERVICE_DELIVERY'],
    selfServiceVisible: true,
    description: 'Authoritative source agency for this record (§28).',
  },
]);

export const BUSINESS_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'business.businessId',
    resourceType: 'BUSINESS',
    classification: 'PUBLIC',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Business registration identifier.',
  },
  {
    field: 'business.name',
    resourceType: 'BUSINESS',
    classification: 'PUBLIC',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Business name as entered on the register.',
  },
  {
    field: 'business.status',
    resourceType: 'BUSINESS',
    classification: 'PUBLIC',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Whether the business registration is current, dormant or revoked.',
  },
  {
    field: 'business.address',
    resourceType: 'BUSINESS',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Registered business address.',
  },
  {
    field: 'business.proprietorPcid',
    resourceType: 'BUSINESS',
    classification: 'SENSITIVE',
    purposes: [
      'CITIZEN_SELF_SERVICE',
      'REVENUE_ADMINISTRATION',
      'CRIMINAL_INVESTIGATION',
      'SERVICE_DELIVERY',
    ],
    selfServiceVisible: true,
    description: 'PCID of the proprietor.',
  },
  {
    field: 'business.sourceAgencyId',
    resourceType: 'BUSINESS',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Authoritative source agency for this record (§28).',
  },
]);

export const LICENCE_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'licence.licenceId',
    resourceType: 'LICENCE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Licence or permit identifier.',
  },
  {
    field: 'licence.type',
    resourceType: 'LICENCE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Category of licence or permit, e.g. driving or trade.',
  },
  {
    field: 'licence.status',
    resourceType: 'LICENCE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Whether the licence is current, expired, suspended or revoked.',
  },
  {
    field: 'licence.validFrom',
    resourceType: 'LICENCE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Date from which the licence is valid.',
  },
  {
    field: 'licence.validTo',
    resourceType: 'LICENCE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Date on which the licence expires.',
  },
  {
    field: 'licence.holderPcid',
    resourceType: 'LICENCE',
    classification: 'SENSITIVE',
    purposes: [
      'CITIZEN_SELF_SERVICE',
      'IDENTITY_VERIFICATION',
      'SERVICE_DELIVERY',
      'CRIMINAL_INVESTIGATION',
    ],
    selfServiceVisible: true,
    description: 'PCID of the licence holder.',
  },
  {
    field: 'licence.sourceAgencyId',
    resourceType: 'LICENCE',
    classification: 'INTERNAL',
    purposes: ALL_SERVICE_PURPOSES,
    selfServiceVisible: true,
    description: 'Authoritative source agency for this record (§28).',
  },
]);

export const MISSING_PERSON_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'missingPerson.caseReference',
    resourceType: 'MISSING_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Reference of the missing-person case.',
  },
  {
    field: 'missingPerson.status',
    resourceType: 'MISSING_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Whether the case is reported, active, located, reunited or closed.',
  },
  {
    field: 'missingPerson.citizenPcid',
    resourceType: 'MISSING_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'PCID of the missing person, where the registry record is known.',
  },
  {
    field: 'missingPerson.fullName',
    resourceType: 'MISSING_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Name of the missing person as reported.',
  },
  {
    field: 'missingPerson.ageYears',
    resourceType: 'MISSING_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Age in years as reported.',
  },
  {
    field: 'missingPerson.sex',
    resourceType: 'MISSING_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Sex of the missing person as reported.',
  },
  {
    field: 'missingPerson.photographUri',
    resourceType: 'MISSING_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Reference to a photograph lawfully supplied with the report.',
  },
  {
    field: 'missingPerson.physicalDescription',
    resourceType: 'MISSING_PERSON',
    classification: 'CONFIDENTIAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Physical description given by the reporting person.',
  },
  {
    field: 'missingPerson.clothingDescription',
    resourceType: 'MISSING_PERSON',
    classification: 'CONFIDENTIAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'What the person was wearing when last seen.',
  },
  {
    field: 'missingPerson.distinguishingFeatures',
    resourceType: 'MISSING_PERSON',
    classification: 'CONFIDENTIAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Marks, scars and other features that would help identify the person.',
  },
  {
    field: 'missingPerson.lastSeen',
    resourceType: 'MISSING_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description:
      'Where and when the person was last seen, as reported. A reported sighting, never an observation the platform made (§16).',
  },
  {
    field: 'missingPerson.circumstances',
    resourceType: 'MISSING_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Circumstances of the disappearance as reported.',
  },
  {
    field: 'missingPerson.reporter',
    resourceType: 'MISSING_PERSON',
    classification: 'HIGHLY_RESTRICTED',
    purposes: ['MISSING_PERSON_INVESTIGATION', 'CRIMINAL_INVESTIGATION'],
    description:
      'Contact details of the person who made the report. Restricted: a reporting person is not a subject of the case.',
  },
  {
    field: 'missingPerson.resolution',
    resourceType: 'MISSING_PERSON',
    classification: 'CONFIDENTIAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'How and when the case was resolved.',
  },
]);

export const UNIDENTIFIED_PERSON_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'unidentifiedPerson.reference',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Reference of the unidentified-person record.',
  },
  {
    field: 'unidentifiedPerson.status',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Whether the person is still unidentified, under review, or identified.',
  },
  {
    field: 'unidentifiedPerson.condition',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Condition the person was found in, including whether they were deceased.',
  },
  {
    field: 'unidentifiedPerson.estimatedAgeRange',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Estimated age range recorded by the responding officer.',
  },
  {
    field: 'unidentifiedPerson.apparentSex',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'INTERNAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Apparent sex recorded by the responding officer.',
  },
  {
    field: 'unidentifiedPerson.photographUri',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Reference to a photograph lawfully collected at the scene.',
  },
  {
    field: 'unidentifiedPerson.physicalDescription',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'CONFIDENTIAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Physical description recorded at the scene.',
  },
  {
    field: 'unidentifiedPerson.clothingDescription',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'CONFIDENTIAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Clothing recorded at the scene.',
  },
  {
    field: 'unidentifiedPerson.distinguishingFeatures',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'CONFIDENTIAL',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Marks, scars and other identifying features recorded at the scene.',
  },
  {
    field: 'unidentifiedPerson.identityClues',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Items or information found with the person that may establish who they are.',
  },
  {
    field: 'unidentifiedPerson.found',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'Where and when the person was encountered.',
  },
  {
    field: 'unidentifiedPerson.biometricCustody',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'LAW_ENFORCEMENT_RESTRICTED',
    purposes: ['MISSING_PERSON_INVESTIGATION', 'CRIMINAL_INVESTIGATION'],
    requiresApproval: true,
    description:
      'Reference to biometric material held by an agency with lawful authority for it. The platform stores no biometric data of its own (§12).',
  },
  {
    field: 'unidentifiedPerson.identifiedPcid',
    resourceType: 'UNIDENTIFIED_PERSON',
    classification: 'SENSITIVE',
    purposes: INVESTIGATIVE_AND_EMERGENCY,
    description: 'PCID the person was identified as, once an officer has confirmed it.',
  },
]);

export const CREDENTIAL_FIELDS: readonly FieldDefinition[] = Object.freeze([
  {
    field: 'credential.serial',
    resourceType: 'CREDENTIAL',
    classification: 'INTERNAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'IDENTITY_VERIFICATION'],
    selfServiceVisible: true,
    description: 'Serial number printed on the credential, distinct from the PCID itself.',
  },
  {
    field: 'credential.format',
    resourceType: 'CREDENTIAL',
    classification: 'INTERNAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'IDENTITY_VERIFICATION'],
    selfServiceVisible: true,
    description: 'Whether this is the digital credential or a printed card.',
  },
  {
    field: 'credential.status',
    resourceType: 'CREDENTIAL',
    classification: 'INTERNAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'IDENTITY_VERIFICATION'],
    selfServiceVisible: true,
    // The resident changes this by reporting the credential lost, which is the
    // one change to it they can make themselves.
    selfServiceEditable: true,
    description: 'Whether the credential is active, suspended, revoked, replaced or expired.',
  },
  {
    field: 'credential.issuedAt',
    resourceType: 'CREDENTIAL',
    classification: 'INTERNAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'IDENTITY_VERIFICATION'],
    selfServiceVisible: true,
    description: 'When the credential was issued.',
  },
  {
    field: 'credential.expiresAt',
    resourceType: 'CREDENTIAL',
    classification: 'INTERNAL',
    purposes: ['CITIZEN_SELF_SERVICE', 'IDENTITY_VERIFICATION'],
    selfServiceVisible: true,
    description: 'When the credential expires and must be replaced.',
  },
  {
    field: 'credential.verificationUrl',
    resourceType: 'CREDENTIAL',
    classification: 'CONFIDENTIAL',
    purposes: ['CITIZEN_SELF_SERVICE'],
    selfServiceVisible: true,
    description:
      'The URL the credential QR encodes. An opaque, short-lived token and nothing else, released only to the holder.',
  },
]);

export const FIELD_CATALOGUE: readonly FieldDefinition[] = Object.freeze([
  ...CITIZEN_FIELDS,
  ...VEHICLE_FIELDS,
  ...PROPERTY_FIELDS,
  ...REVENUE_FIELDS,
  ...BUSINESS_FIELDS,
  ...LICENCE_FIELDS,
  ...MISSING_PERSON_FIELDS,
  ...UNIDENTIFIED_PERSON_FIELDS,
  ...CREDENTIAL_FIELDS,
]);

const BY_FIELD: ReadonlyMap<string, FieldDefinition> = new Map(
  FIELD_CATALOGUE.map((definition) => [definition.field, definition]),
);

const BY_RESOURCE: ReadonlyMap<ResourceType, readonly FieldDefinition[]> = (() => {
  const grouped = new Map<ResourceType, FieldDefinition[]>();
  for (const definition of FIELD_CATALOGUE) {
    const bucket = grouped.get(definition.resourceType) ?? [];
    bucket.push(definition);
    grouped.set(definition.resourceType, bucket);
  }
  return grouped;
})();

export function fieldDefinition(field: string): FieldDefinition | undefined {
  return BY_FIELD.get(field);
}

export function fieldsForResource(resourceType: ResourceType): readonly FieldDefinition[] {
  return BY_RESOURCE.get(resourceType) ?? [];
}

/**
 * The Minimum Necessary Emergency Profile (§10, §38): the only citizen fields a
 * field responder ever receives, before per-field classification checks are applied.
 */
export function emergencyProfileFields(resourceType: ResourceType = 'CITIZEN'): readonly string[] {
  return fieldsForResource(resourceType)
    .filter((definition) => definition.emergencyProfile === true)
    .map((definition) => definition.field);
}

export function selfServiceVisibleFields(resourceType: ResourceType): readonly string[] {
  return fieldsForResource(resourceType)
    .filter((definition) => definition.selfServiceVisible === true)
    .map((definition) => definition.field);
}

export function selfServiceEditableFields(resourceType: ResourceType): readonly string[] {
  return fieldsForResource(resourceType)
    .filter((definition) => definition.selfServiceEditable === true)
    .map((definition) => definition.field);
}
