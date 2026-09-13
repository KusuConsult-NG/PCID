import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { DATA_DOMAINS } from '@pcid/contracts';
import type { DataDomain } from '@pcid/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { contextOf } from '../common/correlation';
import { uuidSchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor, RequiresStepUp } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { IntegrationService } from './integration.service';

const dataSourceSchema = z.object({
  agencyId: uuidSchema,
  domain: z.enum(DATA_DOMAINS as unknown as [string, ...string[]]),
  systemName: z.string().min(2).max(120),
  adapterKey: z.string().min(2).max(64),
  mode: z.enum(['PRODUCTION', 'SANDBOX', 'DISABLED']),
  baseUrl: z.string().url().nullish(),
  config: z.record(z.unknown()).optional(),
});

documentRoute({
  method: 'get',
  path: '/api/v1/integrations',
  tag: 'Integrations',
  summary: 'Data sources and the freshness of each projection',
});
documentRoute({
  method: 'post',
  path: '/api/v1/integrations',
  tag: 'Integrations',
  summary: 'Register an agency data source',
  description:
    'Every external system is reached through one adapter interface. A production adapter needs the ' +
    'agency API base URL and a credential supplied by the secrets manager; sandbox adapters are ' +
    'fixture-backed and refuse to load in a production process.',
  body: dataSourceSchema,
  requiresStepUp: true,
});
documentRoute({
  method: 'post',
  path: '/api/v1/integrations/:dataSourceId/sync',
  tag: 'Integrations',
  summary: 'Synchronise the platform’s projection from the source system',
  description:
    'Writes into the platform’s projection only - never back into the agency’s record. A PCID the ' +
    'source cites that the registry does not hold raises a data conflict for review rather than ' +
    'creating a link. An unreachable source returns FAILED and leaves the last known good ' +
    'projection serving, marked with its age.',
  parameters: [{ name: 'dataSourceId', in: 'path', description: 'Data source id.' }],
  requiresStepUp: true,
});

@Controller('api/v1/integrations')
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get()
  async status(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.integrations.status(actor, contextOf(request));
  }

  @RequiresStepUp()
  @Post()
  async register(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(dataSourceSchema, body);
    return this.integrations.registerDataSource(
      actor,
      {
        agencyId: input.agencyId,
        domain: input.domain as DataDomain,
        systemName: input.systemName,
        adapterKey: input.adapterKey,
        mode: input.mode,
        baseUrl: input.baseUrl ?? null,
        ...(input.config !== undefined ? { config: input.config as Record<string, unknown> } : {}),
      },
      contextOf(request),
    );
  }

  @RequiresStepUp()
  @Post(':dataSourceId/sync')
  async sync(
    @Actor() actor: AuthenticatedActor,
    @Param('dataSourceId') dataSourceId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.integrations.sync(actor, dataSourceId, contextOf(request));
  }
}
