import { BREAK_GLASS_MAX_TTL_SECONDS, isCompartmented } from '@pcid/contracts';
import type { AuditCitizenVisibility, BreakGlassSatisfiableGate } from '@pcid/contracts';

import { CITIZEN_DATA_ACTIONS, MUTATING_ACTIONS, SEARCH_ACTIONS } from './action-metadata';
import { computeFieldRelease } from './field-release';
import {
  accessWindowGate,
  accountStandingGate,
  agencyStandingGate,
  authenticationGate,
  caseBindingGate,
  classificationRankGate,
  compartmentGate,
  dataSharingAgreementGate,
  incidentBindingGate,
  jurisdictionGate,
  purposeGate,
  rbacGate,
  resourceTypeGate,
  selfServiceScopeGate,
  separationOfDutyGate,
  stepUpGate,
} from './gates';
import type { GateResult } from './gates';
import type {
  BreakGlassGrant,
  Obligation,
  PolicyDecision,
  PolicyReason,
  PolicyRequest,
} from './types';

/**
 * Gates that must pass on their own merits. No break-glass grant, approval,
 * administrative role or emergency can relax any of them (§23, §7, §27).
 */
const HARD_GATES: readonly ((request: PolicyRequest) => GateResult)[] = [
  accountStandingGate,
  agencyStandingGate,
  dataSharingAgreementGate,
  authenticationGate,
  stepUpGate,
  rbacGate,
  resourceTypeGate,
  accessWindowGate,
  separationOfDutyGate,
  selfServiceScopeGate,
  purposeGate,
  compartmentGate,
  classificationRankGate,
];

/** Binding gates, which an in-scope break-glass grant may stand in for. */
const RELAXABLE_GATES: readonly ((request: PolicyRequest) => GateResult)[] = [
  jurisdictionGate,
  caseBindingGate,
  incidentBindingGate,
];

function breakGlassSatisfies(
  grant: BreakGlassGrant | null | undefined,
  request: PolicyRequest,
  gate: BreakGlassSatisfiableGate,
): boolean {
  if (!grant) return false;
  if (grant.status !== 'ACTIVE') return false;
  if (grant.userId !== request.subject.userId) return false;
  if (grant.expiresAt.getTime() <= request.now.getTime()) return false;
  if (grant.expiresAt.getTime() - request.now.getTime() > BREAK_GLASS_MAX_TTL_SECONDS * 1000) {
    // A grant longer than the platform ceiling is not honoured, however it was stored.
    return false;
  }
  if (grant.resourceType !== request.resource.type) return false;
  if (grant.subjectPcid != null && grant.subjectPcid !== (request.resource.subjectPcid ?? null)) {
    return false;
  }
  return grant.gates.includes(gate);
}

function deny(reasons: readonly PolicyReason[]): PolicyDecision {
  return {
    effect: 'DENY',
    reasons,
    allowedFields: [],
    withheldFields: [],
    obligations: [{ kind: 'AUDIT' }],
    citizenVisibility: 'ACCESS_VISIBLE_TO_CITIZEN',
    breakGlassUsed: false,
    approvalsUsed: [],
    ttlSeconds: 0,
  };
}

function citizenVisibilityFor(request: PolicyRequest): {
  visibility: AuditCitizenVisibility;
  obligation: Obligation | null;
} {
  // §26: an investigation may need delayed or restricted disclosure, but the
  // restriction is never silent - it carries a stated basis into the audit record.
  if (request.purpose === 'CRIMINAL_INVESTIGATION') {
    return {
      visibility: 'ACCESS_RESTRICTED_FROM_CITIZEN',
      obligation: {
        kind: 'RESTRICT_FROM_CITIZEN',
        legalBasis:
          'Access made under an active criminal investigation; disclosure to the data subject is deferred pending case closure and review by the Data Protection Officer.',
      },
    };
  }
  if (isCompartmented(request.resource.classification)) {
    return {
      visibility: 'ACCESS_RESTRICTED_FROM_CITIZEN',
      obligation: {
        kind: 'RESTRICT_FROM_CITIZEN',
        legalBasis:
          'Record carries a law-enforcement compartment marking; disclosure is governed by the owning agency.',
      },
    };
  }
  return { visibility: 'ACCESS_VISIBLE_TO_CITIZEN', obligation: null };
}

/**
 * Evaluate an access request.
 *
 * The engine is deny-by-default and deny-overrides: it performs no I/O, mutates
 * nothing, and reaches PERMIT only when every gate has been satisfied on the
 * evidence supplied. A caller that cannot supply the evidence gets a denial that
 * names the gate, so the interface can ask for exactly what is missing - a case
 * number, an approval, a step-up - rather than failing opaquely.
 */
export function evaluate(request: PolicyRequest): PolicyDecision {
  for (const gate of HARD_GATES) {
    const failure = gate(request);
    if (failure) return deny([failure.reason]);
  }

  const relaxedGates: BreakGlassSatisfiableGate[] = [];
  for (const gate of RELAXABLE_GATES) {
    const failure = gate(request);
    if (!failure) continue;
    const relaxableBy = failure.relaxableBy;
    if (
      relaxableBy !== undefined &&
      breakGlassSatisfies(request.breakGlass, request, relaxableBy)
    ) {
      relaxedGates.push(relaxableBy);
      continue;
    }
    return deny([failure.reason]);
  }

  const release = computeFieldRelease(request);
  const readsData = CITIZEN_DATA_ACTIONS.has(request.action);

  if (readsData && release.allowedFields.length === 0) {
    return {
      ...deny([
        {
          gate: 'FIELD_RELEASE',
          code: 'NO_FIELDS_RELEASABLE',
          message:
            'No field of this record may be released to this account for the stated purpose.',
        },
      ]),
      withheldFields: release.withheldFields,
    };
  }

  const breakGlassUsed = relaxedGates.length > 0 || release.breakGlassUsedForFields;
  const { visibility, obligation: visibilityObligation } = citizenVisibilityFor(request);

  const obligations: Obligation[] = [{ kind: 'AUDIT' }];
  if (breakGlassUsed) {
    obligations.push({
      kind: 'NOTIFY_SUPERVISOR',
      reason: `Break-glass grant ${request.breakGlass?.grantId ?? 'unknown'} was relied upon for: ${
        relaxedGates.length > 0 ? relaxedGates.join(', ') : 'FIELD_APPROVAL'
      }.`,
    });
    obligations.push({ kind: 'POST_EVENT_REVIEW', dueWithinSeconds: 60 * 60 * 24 });
  }
  if (request.action === 'EMERGENCY_PROFILE_VIEW') {
    obligations.push({ kind: 'MINIMUM_NECESSARY_PROFILE' });
  }
  if (SEARCH_ACTIONS.has(request.action) || request.action === 'CITIZEN_EXPORT') {
    obligations.push({ kind: 'RATE_LIMIT_SENSITIVE' });
  }
  if (visibilityObligation) obligations.push(visibilityObligation);

  const ttlSeconds = breakGlassUsed || MUTATING_ACTIONS.has(request.action) ? 0 : 30;

  return {
    effect: 'PERMIT',
    reasons: [],
    allowedFields: release.allowedFields,
    withheldFields: release.withheldFields,
    obligations,
    citizenVisibility: visibility,
    breakGlassUsed,
    approvalsUsed: release.approvalsUsed,
    ttlSeconds,
  };
}

/**
 * Reduce a record to the fields a decision released. The only supported way to
 * turn a stored record into a response body: it cannot return a field the
 * decision did not clear, whatever the caller passes in.
 */
export function projectFields<T extends Record<string, unknown>>(
  record: T,
  decision: PolicyDecision,
  prefix: string,
): Record<string, unknown> {
  if (decision.effect !== 'PERMIT') return {};
  const allowed = new Set(decision.allowedFields);
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (allowed.has(`${prefix}.${key}`)) projected[key] = value;
  }
  return projected;
}

/** Field paths withheld for this decision, for rendering "Restricted information" (§29). */
export function restrictedFieldPaths(decision: PolicyDecision): readonly string[] {
  return decision.withheldFields.map((withheld) => withheld.field);
}
