import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Purpose } from '@pcid/contracts';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { citizenViewQuerySchema, propertySearchSchema, vehicleSearchSchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { AssetsService } from './assets.service';

documentRoute({
  method: 'get',
  path: '/api/v1/vehicles',
  tag: 'Linked records',
  summary: 'Look up a vehicle by registration number',
  description:
    'Served from the platform’s projection of the transport authority’s record, with provenance ' +
    'and a staleness flag attached. Owner contact details are restricted and need an approval; ' +
    'stolen and wanted markers carry the law-enforcement compartment.',
  parameters: [
    {
      name: 'registrationNumber',
      in: 'query',
      required: true,
      description: 'Vehicle registration number.',
    },
    {
      name: 'purpose',
      in: 'query',
      required: true,
      description: 'The lawful purpose for this query.',
    },
    { name: 'caseRef', in: 'query', description: 'Case authorising an investigative query.' },
    { name: 'incidentRef', in: 'query', description: 'Incident authorising an emergency query.' },
  ],
  actions: ['VEHICLE_SEARCH'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/vehicles/:vehicleId',
  tag: 'Linked records',
  summary: 'View one vehicle record',
  parameters: [
    { name: 'vehicleId', in: 'path', description: 'Vehicle id.' },
    {
      name: 'purpose',
      in: 'query',
      required: true,
      description: 'The lawful purpose for this access.',
    },
    { name: 'caseRef', in: 'query', description: 'Case the record is associated with (§22).' },
  ],
  actions: ['VEHICLE_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/properties',
  tag: 'Linked records',
  summary: 'Search properties',
  description:
    'For fire, rescue and disaster response the emergency access notes and estimated occupancy are ' +
    'released; those fields are catalogued for emergency purposes only.',
  parameters: [
    {
      name: 'purpose',
      in: 'query',
      required: true,
      description: 'The lawful purpose for this query.',
    },
    { name: 'propertyId', in: 'query', description: 'Lands registry identifier.' },
    { name: 'address', in: 'query', description: 'Partial address.' },
    { name: 'lgaCode', in: 'query', description: 'Local Government Area.' },
  ],
  actions: ['PROPERTY_SEARCH'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/properties/:propertyId',
  tag: 'Linked records',
  summary: 'View one property record',
  parameters: [
    { name: 'propertyId', in: 'path', description: 'Property id.' },
    {
      name: 'purpose',
      in: 'query',
      required: true,
      description: 'The lawful purpose for this access.',
    },
  ],
  actions: ['PROPERTY_VIEW'],
});

@Controller('api/v1')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('vehicles')
  async searchVehicles(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(vehicleSearchSchema, query);
    return this.assets.searchVehicles(
      actor,
      input.purpose as Purpose,
      input.registrationNumber,
      {
        caseRef: input.caseRef ?? null,
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }

  @Get('vehicles/:vehicleId')
  async viewVehicle(
    @Actor() actor: AuthenticatedActor,
    @Param('vehicleId') vehicleId: string,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(citizenViewQuerySchema, query);
    return this.assets.viewVehicle(
      actor,
      input.purpose as Purpose,
      vehicleId,
      {
        caseRef: input.caseRef ?? null,
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }

  @Get('properties')
  async searchProperties(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(propertySearchSchema, query);
    return this.assets.searchProperties(
      actor,
      input.purpose as Purpose,
      {
        ...(input.propertyId !== undefined ? { propertyId: input.propertyId } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.lgaCode !== undefined ? { lgaCode: input.lgaCode } : {}),
      },
      {
        caseRef: input.caseRef ?? null,
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }

  @Get('properties/:propertyId')
  async viewProperty(
    @Actor() actor: AuthenticatedActor,
    @Param('propertyId') propertyId: string,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(citizenViewQuerySchema, query);
    return this.assets.viewProperty(
      actor,
      input.purpose as Purpose,
      propertyId,
      {
        caseRef: input.caseRef ?? null,
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }
}
