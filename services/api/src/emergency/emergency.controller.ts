import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { IncidentStatus, IncidentType } from '@pcid/contracts';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import {
  createIncidentSchema,
  createResponseUnitSchema,
  dispatchSchema,
  dispatchStatusSchema,
  incidentListSchema,
  incidentOfficerSchema,
  incidentPersonSchema,
  incidentStatusSchema,
  unitListSchema,
  unitPositionSchema,
  updateResponseUnitSchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { DispatchService } from './dispatch.service';
import { IncidentsService } from './incidents.service';
import type { CreateIncidentInput } from './incidents.service';

documentRoute({
  method: 'post',
  path: '/api/v1/incidents',
  tag: 'Emergency',
  summary: 'Create an incident',
  description:
    'Opens the record that authorises emergency access to citizen information for the responders ' +
    'assigned to it. Any coordinate supplied is stored with its provenance and a retention date; ' +
    'the platform holds no means of locating a person.',
  body: createIncidentSchema,
  actions: ['INCIDENT_CREATE'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/incidents',
  tag: 'Emergency',
  summary: 'List incidents',
  parameters: [
    { name: 'status', in: 'query', description: 'Filter by status.' },
    { name: 'type', in: 'query', description: 'Filter by incident type.' },
    { name: 'lgaCode', in: 'query', description: 'Filter by Local Government Area.' },
    { name: 'activeOnly', in: 'query', description: 'Only incidents still in progress.' },
  ],
  actions: ['INCIDENT_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/incidents/:reference',
  tag: 'Emergency',
  summary: 'View one incident with its timeline, units and measured response times',
  parameters: [
    { name: 'reference', in: 'path', description: 'Incident number, e.g. INC-2026-000123.' },
  ],
  actions: ['INCIDENT_VIEW'],
});
documentRoute({
  method: 'patch',
  path: '/api/v1/incidents/:reference/status',
  tag: 'Emergency',
  summary: 'Move an incident to a new status',
  description: 'Closing an incident also closes the emergency access it authorised.',
  parameters: [{ name: 'reference', in: 'path', description: 'Incident number.' }],
  body: incidentStatusSchema,
  actions: ['INCIDENT_UPDATE', 'INCIDENT_CLOSE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/incidents/:reference/persons',
  tag: 'Emergency',
  summary: 'Attach a person to an incident',
  description:
    'Used when a casualty is identified, or when an unidentified person record is linked.',
  parameters: [{ name: 'reference', in: 'path', description: 'Incident number.' }],
  body: incidentPersonSchema,
  actions: ['INCIDENT_UPDATE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/incidents/:reference/officers',
  tag: 'Emergency',
  summary: 'Attach an officer to an incident',
  description:
    'The ordinary answer to "I am not attached": control attaches you, and it takes seconds. ' +
    'Attachment by agency happens on its own when a unit is dispatched; this is the individual ' +
    'case - a paramedic from another service, an incident officer taking a handover, a commander ' +
    'joining a major incident. A closed incident authorises nothing, so nobody can be added to one.',
  parameters: [{ name: 'reference', in: 'path', description: 'Incident number.' }],
  body: incidentOfficerSchema,
  actions: ['INCIDENT_UPDATE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/incidents/:reference/dispatch',
  tag: 'Emergency',
  summary: 'Dispatch a response unit',
  description:
    'Assigning a unit also assigns its agency to the incident, which is what opens incident-bound ' +
    'emergency access for the attending crew.',
  parameters: [{ name: 'reference', in: 'path', description: 'Incident number.' }],
  body: dispatchSchema,
  actions: ['DISPATCH_CREATE'],
});
documentRoute({
  method: 'patch',
  path: '/api/v1/dispatches/:dispatchId',
  tag: 'Emergency',
  summary: 'Update a dispatch as the unit acknowledges, travels, arrives and completes',
  parameters: [{ name: 'dispatchId', in: 'path', description: 'Dispatch id.' }],
  body: dispatchStatusSchema,
  actions: ['DISPATCH_UPDATE'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/response-units',
  tag: 'Emergency',
  summary: 'List response units, optionally ordered by distance from an incident',
  parameters: [
    { name: 'status', in: 'query', description: 'Filter by operational status.' },
    { name: 'agencyId', in: 'query', description: 'Filter by owning agency.' },
    { name: 'lgaCode', in: 'query', description: 'Filter by home LGA.' },
    {
      name: 'nearIncident',
      in: 'query',
      description: 'Return available units nearest this incident.',
    },
  ],
  actions: ['RESPONSE_UNIT_VIEW'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/response-units',
  tag: 'Emergency',
  summary: 'Register a response unit',
  description:
    'Fleet administration: a unit is a vehicle and a crew, and nothing here is citizen data. ' +
    'There is no position field - where a unit is, is something the unit reports.',
  body: createResponseUnitSchema,
  actions: ['RESPONSE_UNIT_MANAGE'],
});
documentRoute({
  method: 'patch',
  path: '/api/v1/response-units/:unitCode',
  tag: 'Emergency',
  summary: 'Change a response unit, or take it in and out of service',
  description:
    'Status is limited to AVAILABLE and OFFLINE. The operational statuses belong to the dispatch ' +
    'workflow, which knows whether they are true; a fleet screen that could write them would let ' +
    'somebody mark an ambulance available while it is carrying a patient.',
  parameters: [{ name: 'unitCode', in: 'path', description: 'Unit code.' }],
  body: updateResponseUnitSchema,
  actions: ['RESPONSE_UNIT_MANAGE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/response-units/:unitCode/position',
  tag: 'Emergency',
  summary: 'A unit reports its own operational position',
  description:
    'The only live positions the platform holds are those of response units, reported by the unit ' +
    'itself. There is no citizen equivalent.',
  parameters: [{ name: 'unitCode', in: 'path', description: 'Unit code.' }],
  body: unitPositionSchema,
  actions: ['DISPATCH_UPDATE'],
});

@Controller('api/v1')
export class EmergencyController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly dispatch: DispatchService,
  ) {}

  @Post('incidents')
  async create(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(createIncidentSchema, body);
    return this.incidents.create(
      actor,
      input as unknown as CreateIncidentInput,
      contextOf(request),
    );
  }

  @Get('incidents')
  async list(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(incidentListSchema, query);
    return this.incidents.list(
      actor,
      {
        ...(input.status !== undefined ? { status: input.status as IncidentStatus } : {}),
        ...(input.type !== undefined ? { type: input.type as IncidentType } : {}),
        ...(input.lgaCode !== undefined ? { lgaCode: input.lgaCode } : {}),
        ...(input.activeOnly !== undefined ? { activeOnly: input.activeOnly } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      contextOf(request),
    );
  }

  @Get('incidents/:reference')
  async view(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.incidents.view(actor, reference, contextOf(request));
  }

  @Patch('incidents/:reference/status')
  async updateStatus(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(incidentStatusSchema, body);
    return this.incidents.updateStatus(
      actor,
      reference,
      input.status as IncidentStatus,
      input.note ?? null,
      contextOf(request),
    );
  }

  @Post('incidents/:reference/persons')
  async attachPerson(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(incidentPersonSchema, body);
    return this.incidents.attachPerson(
      actor,
      reference,
      {
        citizenPcid: input.citizenPcid ?? null,
        unidentifiedPersonId: input.unidentifiedPersonId ?? null,
        role: input.role,
        note: input.note ?? null,
      },
      contextOf(request),
    );
  }

  @Post('incidents/:reference/officers')
  async attachOfficer(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(incidentOfficerSchema, body);
    return this.incidents.attachOfficer(
      actor,
      reference,
      input.userId,
      input.role,
      contextOf(request),
    );
  }

  @Post('incidents/:reference/dispatch')
  async dispatchUnit(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(dispatchSchema, body);
    return this.dispatch.dispatch(
      actor,
      reference,
      input.unitCode,
      input.note ?? null,
      contextOf(request),
    );
  }

  @Patch('dispatches/:dispatchId')
  async updateDispatch(
    @Actor() actor: AuthenticatedActor,
    @Param('dispatchId') dispatchId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(dispatchStatusSchema, body);
    return this.dispatch.updateDispatch(
      actor,
      dispatchId,
      input.status as never,
      input.note ?? null,
      contextOf(request),
    );
  }

  @Get('response-units')
  async listUnits(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(unitListSchema, query);
    return this.dispatch.listUnits(
      actor,
      {
        ...(input.status !== undefined ? { status: input.status as never } : {}),
        ...(input.agencyId !== undefined ? { agencyId: input.agencyId } : {}),
        ...(input.lgaCode !== undefined ? { lgaCode: input.lgaCode } : {}),
        ...(input.nearIncident !== undefined ? { nearIncident: input.nearIncident } : {}),
      },
      contextOf(request),
    );
  }

  @Post('response-units')
  async createUnit(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(createResponseUnitSchema, body);
    return this.dispatch.createUnit(
      actor,
      {
        unitCode: input.unitCode,
        ...(input.agencyId !== undefined ? { agencyId: input.agencyId } : {}),
        type: input.type,
        ...(input.homeLgaCode !== undefined ? { homeLgaCode: input.homeLgaCode } : {}),
        ...(input.homeWardCode !== undefined ? { homeWardCode: input.homeWardCode } : {}),
        ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.status !== undefined ? { status: input.status as 'AVAILABLE' | 'OFFLINE' } : {}),
      },
      contextOf(request),
    );
  }

  @Patch('response-units/:unitCode')
  async updateUnit(
    @Actor() actor: AuthenticatedActor,
    @Param('unitCode') unitCode: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(updateResponseUnitSchema, body);
    return this.dispatch.updateUnit(
      actor,
      unitCode,
      {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.homeLgaCode !== undefined ? { homeLgaCode: input.homeLgaCode } : {}),
        ...(input.homeWardCode !== undefined ? { homeWardCode: input.homeWardCode } : {}),
        ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.status !== undefined ? { status: input.status as 'AVAILABLE' | 'OFFLINE' } : {}),
      },
      contextOf(request),
    );
  }

  @Post('response-units/:unitCode/position')
  async reportPosition(
    @Actor() actor: AuthenticatedActor,
    @Param('unitCode') unitCode: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(unitPositionSchema, body);
    return this.dispatch.reportUnitPosition(actor, unitCode, input, contextOf(request));
  }
}
