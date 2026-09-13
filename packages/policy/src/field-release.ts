import {
  classificationRank,
  emergencyProfileFields,
  fieldDefinition,
  fieldsForResource,
  isCompartmented,
  rankDominates,
} from '@pcid/contracts';
import type { Classification, FieldDefinition } from '@pcid/contracts';

import { SEARCH_ACTIONS } from './action-metadata';
import { effectiveClearance } from './gates';
import type { AccessApproval, BreakGlassGrant, PolicyRequest, WithheldField } from './types';

/**
 * Ceiling applied to a search projection. A search answers "is this the person
 * you mean", not "tell me about this person" (§62, §63), so nothing above
 * INTERNAL is ever returned in a search result.
 */
const SEARCH_PROJECTION_CEILING: Classification = 'INTERNAL';

export interface FieldReleaseResult {
  readonly allowedFields: readonly string[];
  readonly withheldFields: readonly WithheldField[];
  readonly approvalsUsed: readonly string[];
  readonly breakGlassUsedForFields: boolean;
}

function approvalCovers(approval: AccessApproval, request: PolicyRequest, field: string): boolean {
  if (approval.status !== 'APPROVED') return false;
  if (approval.userId !== request.subject.userId) return false;
  if (approval.expiresAt.getTime() <= request.now.getTime()) return false;
  if (approval.resourceType !== request.resource.type) return false;
  if (approval.purpose !== request.purpose) return false;
  if (
    approval.subjectPcid != null &&
    approval.subjectPcid !== (request.resource.subjectPcid ?? null)
  ) {
    return false;
  }
  return approval.approvedFields.includes(field);
}

function breakGlassCoversFieldApproval(
  grant: BreakGlassGrant | null | undefined,
  request: PolicyRequest,
): boolean {
  if (!grant) return false;
  if (grant.status !== 'ACTIVE') return false;
  if (grant.userId !== request.subject.userId) return false;
  if (grant.expiresAt.getTime() <= request.now.getTime()) return false;
  if (grant.resourceType !== request.resource.type) return false;
  if (grant.subjectPcid != null && grant.subjectPcid !== (request.resource.subjectPcid ?? null)) {
    return false;
  }
  return grant.gates.includes('FIELD_APPROVAL');
}

/**
 * Compute the field set the caller may return (master system prompt §27, §29, §38).
 *
 * Every candidate field must pass, independently:
 *   - the purpose the field is catalogued for;
 *   - the rank ceiling of the person and their agency;
 *   - the compartment marking, if any;
 *   - an approval or break-glass grant, where the catalogue demands one;
 *   - the self-service visibility flag, for citizen actors;
 *   - the minimum-necessary emergency projection, for responder reads;
 *   - the thin search projection, for search reads.
 *
 * Anything not explicitly cleared is withheld, and the reason is recorded so the
 * interface can honestly say "Restricted information" rather than pretending the
 * field does not exist.
 */
export function computeFieldRelease(request: PolicyRequest): FieldReleaseResult {
  const { subject, action, purpose, resource } = request;
  const catalogue = fieldsForResource(resource.type);
  const ceiling = effectiveClearance(subject);
  const isSearch = SEARCH_ACTIONS.has(action);
  const isEmergencyProfile = action === 'EMERGENCY_PROFILE_VIEW';
  const emergencyAllowed = new Set(emergencyProfileFields(resource.type));
  const approvals = request.approvals ?? [];
  const breakGlassFieldApproval = breakGlassCoversFieldApproval(request.breakGlass, request);

  const requested = resource.requestedFields;
  const candidates: readonly FieldDefinition[] =
    requested === undefined
      ? catalogue
      : requested
          .map((field) => fieldDefinition(field))
          .filter((definition): definition is FieldDefinition => definition !== undefined);

  const unknownRequested =
    requested === undefined
      ? []
      : requested.filter((field) => {
          const definition = fieldDefinition(field);
          return definition === undefined || definition.resourceType !== resource.type;
        });

  const allowedFields: string[] = [];
  const withheldFields: WithheldField[] = unknownRequested.map((field) => ({
    field,
    gate: 'FIELD_RELEASE' as const,
    code: 'FIELD_NOT_IN_CATALOGUE',
  }));
  const approvalsUsed = new Set<string>();
  let breakGlassUsedForFields = false;

  for (const definition of candidates) {
    if (definition.resourceType !== resource.type) continue;

    if (!definition.purposes.includes(purpose)) {
      withheldFields.push({
        field: definition.field,
        gate: 'FIELD_RELEASE',
        code: 'FIELD_NOT_RELEASABLE_FOR_PURPOSE',
      });
      continue;
    }

    if (!rankDominates(ceiling, definition.classification)) {
      withheldFields.push({
        field: definition.field,
        gate: 'FIELD_RELEASE',
        code: 'FIELD_ABOVE_CLEARANCE',
      });
      continue;
    }

    if (
      isCompartmented(definition.classification) &&
      !subject.compartments.includes(definition.classification)
    ) {
      withheldFields.push({
        field: definition.field,
        gate: 'FIELD_RELEASE',
        code: 'FIELD_COMPARTMENT_NOT_HELD',
      });
      continue;
    }

    if (subject.actorType === 'CITIZEN' && definition.selfServiceVisible !== true) {
      withheldFields.push({
        field: definition.field,
        gate: 'FIELD_RELEASE',
        code: 'FIELD_NOT_SELF_SERVICE_VISIBLE',
      });
      continue;
    }

    if (isEmergencyProfile && !emergencyAllowed.has(definition.field)) {
      withheldFields.push({
        field: definition.field,
        gate: 'FIELD_RELEASE',
        code: 'OUTSIDE_MINIMUM_NECESSARY_EMERGENCY_PROFILE',
      });
      continue;
    }

    if (
      isSearch &&
      classificationRank(definition.classification) > classificationRank(SEARCH_PROJECTION_CEILING)
    ) {
      withheldFields.push({
        field: definition.field,
        gate: 'FIELD_RELEASE',
        code: 'OUTSIDE_SEARCH_PROJECTION',
      });
      continue;
    }

    if (definition.requiresApproval === true && subject.actorType !== 'CITIZEN') {
      const approval = approvals.find((candidate) =>
        approvalCovers(candidate, request, definition.field),
      );
      if (approval) {
        approvalsUsed.add(approval.accessRequestId);
      } else if (breakGlassFieldApproval) {
        breakGlassUsedForFields = true;
      } else {
        withheldFields.push({
          field: definition.field,
          gate: 'FIELD_RELEASE',
          code: 'FIELD_REQUIRES_APPROVAL',
        });
        continue;
      }
    }

    allowedFields.push(definition.field);
  }

  return {
    allowedFields,
    withheldFields,
    approvalsUsed: [...approvalsUsed],
    breakGlassUsedForFields,
  };
}
