import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { analyticsQuerySchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { AnalyticsService } from './analytics.service';

const analyticsParameters = [
  { name: 'from', in: 'query' as const, description: 'Earliest timestamp, inclusive.' },
  { name: 'to', in: 'query' as const, description: 'Latest timestamp, inclusive.' },
  { name: 'lgaCode', in: 'query' as const, description: 'Restrict to one Local Government Area.' },
];

documentRoute({
  method: 'get',
  path: '/api/v1/analytics/incidents',
  tag: 'Analytics',
  summary: 'Incident volumes, categories and response times',
  description:
    'Aggregates only. Buckets below the suppression threshold are reported as suppressed rather ' +
    'than as counts, because a count of one in a ward identifies a person.',
  parameters: analyticsParameters,
});
documentRoute({
  method: 'get',
  path: '/api/v1/analytics/hotspots',
  tag: 'Analytics',
  summary: 'Wards with recurring incident demand',
  description: 'Ward granularity with small-number suppression. Not household or individual level.',
  parameters: analyticsParameters,
});
documentRoute({
  method: 'get',
  path: '/api/v1/analytics/response-units',
  tag: 'Analytics',
  summary: 'Response performance by unit type and agency',
  description:
    'Grouped by unit type and agency, never by individual responder: this measures capacity.',
  parameters: analyticsParameters.slice(0, 2),
});
documentRoute({
  method: 'get',
  path: '/api/v1/analytics/missing-persons',
  tag: 'Analytics',
  summary: 'Missing-person case volumes and time to resolution',
  parameters: analyticsParameters.slice(0, 2),
});

@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('incidents')
  async incidents(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.analytics.incidentSummary(
      actor,
      validate(analyticsQuerySchema, query),
      contextOf(request),
    );
  }

  @Get('hotspots')
  async hotspots(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.analytics.incidentHotspots(
      actor,
      validate(analyticsQuerySchema, query),
      contextOf(request),
    );
  }

  @Get('response-units')
  async responseUnits(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.analytics.responseUnitPerformance(
      actor,
      validate(analyticsQuerySchema, query),
      contextOf(request),
    );
  }

  @Get('missing-persons')
  async missingPersons(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.analytics.missingPersonTrends(
      actor,
      validate(analyticsQuerySchema, query),
      contextOf(request),
    );
  }
}
