import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { auditSearchSchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from './audit.service';

documentRoute({
  method: 'get',
  path: '/api/v1/audit/events',
  tag: 'Audit',
  summary: 'Search the audit trail',
  description:
    'Every access to citizen information, permitted or denied, appears here with the actor, their ' +
    'agency and roles, the declared purpose, the case or incident relied upon, the fields released, ' +
    'the fields withheld and why, and whether break glass was used.',
  parameters: [
    { name: 'actorId', in: 'query', description: 'Filter by the account that acted.' },
    { name: 'agencyId', in: 'query', description: 'Filter by agency.' },
    { name: 'subjectPcid', in: 'query', description: 'Filter by the person the access concerned.' },
    { name: 'action', in: 'query', description: 'Filter by action.' },
    { name: 'outcome', in: 'query', description: 'PERMITTED, DENIED or ERROR.' },
    {
      name: 'breakGlassOnly',
      in: 'query',
      description: 'Only accesses that relied on break glass.',
    },
    { name: 'from', in: 'query', description: 'Earliest timestamp, inclusive.' },
    { name: 'to', in: 'query', description: 'Latest timestamp, inclusive.' },
  ],
  actions: ['AUDIT_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/audit/verify',
  tag: 'Audit',
  summary: 'Verify the tamper-evident audit chain',
  description:
    'Recomputes the hash chain in the database and reports any row whose content or predecessor ' +
    'does not agree. An intact chain is evidence the history has not been altered.',
  actions: ['AUDIT_VERIFY'],
});

@Controller('api/v1/audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  @Get('events')
  async search(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(auditSearchSchema, query);
    await this.policy.authorize({
      actor,
      action: 'AUDIT_VIEW',
      purpose: 'AUDIT_REVIEW',
      resource: {
        type: 'AUDIT_EVENT',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: input.subjectPcid ?? null,
      },
      context: contextOf(request),
    });
    const result = await this.audit.search({
      actorId: input.actorId ?? null,
      agencyId: input.agencyId ?? null,
      subjectPcid: input.subjectPcid ?? null,
      action: input.action ?? null,
      outcome: input.outcome ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
      ...(input.breakGlassOnly !== undefined ? { breakGlassOnly: input.breakGlassOnly } : {}),
      limit: input.limit,
      offset: input.offset,
    });
    return {
      total: result.total,
      events: result.rows.map((row) => ({
        seq: Number(row.seq),
        id: row.id,
        occurredAt: row.occurred_at.toISOString(),
        action: row.action,
        outcome: row.outcome,
        actor: {
          type: row.actor_type,
          id: row.actor_id,
          displayName: row.actor_display,
          agencyId: row.agency_id,
          agencyCode: row.agency_code,
        },
        purpose: row.purpose,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        subjectPcid: row.subject_pcid,
        caseNumber: row.case_number,
        incidentNumber: row.incident_number,
        fieldsReleased: row.fields_released,
        fieldsWithheld: row.fields_withheld,
        decisionReasons: row.decision_reasons,
        breakGlassUsed: row.break_glass_used,
        citizenVisibility: row.citizen_visibility,
        restrictionBasis: row.restriction_basis,
        correlationId: row.correlation_id,
        // What the action actually did: which change, which reference, which
        // stated reason. An oversight review needs this, and by the platform's
        // logging discipline it carries identifiers and outcomes rather than
        // record values. It is never included in the citizen-facing history.
        detail: row.detail,
      })),
    };
  }

  @Get('verify')
  async verify(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    await this.policy.authorize({
      actor,
      action: 'AUDIT_VERIFY',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'AUDIT_EVENT', id: null, classification: 'INTERNAL', subjectPcid: null },
      context: contextOf(request),
    });
    const result = await this.audit.verifyChain();
    return {
      intact: result.intact,
      problems: result.problems,
      checkedAt: new Date().toISOString(),
    };
  }
}
