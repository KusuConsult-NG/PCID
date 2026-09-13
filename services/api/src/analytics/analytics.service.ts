import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../common/correlation';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

/**
 * Public safety analytics (master system prompt §19, §34).
 *
 * Everything here is an aggregate over incidents, response performance and case
 * volumes. Two rules hold throughout:
 *
 *  - **small-number suppression.** Any bucket below the threshold is reported as
 *    suppressed rather than as a count, because a count of one in a ward is a
 *    person, not a statistic;
 *  - **no citizen scoring.** There is no method here that scores, ranks or
 *    classifies a person, and no query groups by any protected or sensitive
 *    characteristic. §19 and §64 rule those out, and the way to keep them ruled
 *    out is for the capability not to exist.
 */
@Injectable()
export class AnalyticsService {
  /** Buckets with fewer than this many records are suppressed. */
  static readonly SUPPRESSION_THRESHOLD = 5;

  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
  ) {}

  async incidentSummary(
    actor: AuthenticatedActor,
    filters: { from?: string; to?: string; lgaCode?: string },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.authorize(actor, context, filters.lgaCode ?? null);

    const where = new WhereBuilder();
    if (filters.from !== undefined) where.add('reported_at >= ?::timestamptz', filters.from);
    if (filters.to !== undefined) where.add('reported_at <= ?::timestamptz', filters.to);
    if (filters.lgaCode !== undefined) where.add('lga_code = ?', filters.lgaCode);

    const [byLga, byType, bySeverity, byHour, responseTimes, openCounts] = await Promise.all([
      this.db.query<{ bucket: string | null; count: string }>(
        `SELECT lga_code AS bucket, count(*)::text AS count FROM incident ${where.sql}
          GROUP BY lga_code ORDER BY count(*) DESC`,
        where.params,
      ),
      this.db.query<{ bucket: string; count: string }>(
        `SELECT type AS bucket, count(*)::text AS count FROM incident ${where.sql}
          GROUP BY type ORDER BY count(*) DESC`,
        where.params,
      ),
      this.db.query<{ bucket: string; count: string }>(
        `SELECT severity AS bucket, count(*)::text AS count FROM incident ${where.sql}
          GROUP BY severity`,
        where.params,
      ),
      this.db.query<{ bucket: string; count: string }>(
        `SELECT to_char(date_trunc('hour', reported_at), 'HH24') AS bucket, count(*)::text AS count
           FROM incident ${where.sql} GROUP BY 1 ORDER BY 1`,
        where.params,
      ),
      this.db.queryOne<{
        median_dispatch: string | null;
        median_arrival: string | null;
        median_total: string | null;
        measured: string;
      }>(
        `SELECT
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (first_dispatched_at - reported_at))
           )::text AS median_dispatch,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (first_arrival_at - first_dispatched_at))
           )::text AS median_arrival,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (first_arrival_at - reported_at))
           )::text AS median_total,
           count(*) FILTER (WHERE first_arrival_at IS NOT NULL)::text AS measured
         FROM incident ${where.sql}`,
        where.params,
      ),
      this.db.queryOne<{ open_incidents: string; open_missing: string }>(
        `SELECT
           (SELECT count(*)::text FROM incident
             WHERE status IN ('REPORTED','VERIFIED','DISPATCHED','ON_SCENE','CONTAINED')) AS open_incidents,
           (SELECT count(*)::text FROM missing_person
             WHERE status IN ('REPORTED','VERIFIED','ACTIVE')) AS open_missing`,
      ),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      suppressionThreshold: AnalyticsService.SUPPRESSION_THRESHOLD,
      openIncidents: Number(openCounts?.open_incidents ?? 0),
      openMissingPersonCases: Number(openCounts?.open_missing ?? 0),
      incidentsByLga: suppress(byLga),
      incidentsByType: suppress(byType),
      incidentsBySeverity: suppress(bySeverity),
      incidentsByHourOfDay: suppress(byHour),
      responseTimeSeconds: {
        medianCallToDispatch: numberOrNull(responseTimes?.median_dispatch),
        medianDispatchToArrival: numberOrNull(responseTimes?.median_arrival),
        medianTotal: numberOrNull(responseTimes?.median_total),
        incidentsMeasured: Number(responseTimes?.measured ?? 0),
      },
    };
  }

  /**
   * Repeat-incident locations (§19). Reported at ward granularity and only where
   * the count clears the suppression threshold, so the output describes places
   * with recurring demand rather than identifying households.
   */
  async incidentHotspots(
    actor: AuthenticatedActor,
    filters: { from?: string; to?: string; lgaCode?: string },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.authorize(actor, context, filters.lgaCode ?? null);

    const where = new WhereBuilder().addRaw('ward_code IS NOT NULL');
    if (filters.from !== undefined) where.add('reported_at >= ?::timestamptz', filters.from);
    if (filters.to !== undefined) where.add('reported_at <= ?::timestamptz', filters.to);
    if (filters.lgaCode !== undefined) where.add('lga_code = ?', filters.lgaCode);

    const rows = await this.db.query<{
      ward_code: string;
      lga_code: string | null;
      count: string;
      top_type: string;
    }>(
      `SELECT ward_code, lga_code, count(*)::text AS count,
              (array_agg(type ORDER BY type))[1] AS top_type
         FROM incident ${where.sql}
        GROUP BY ward_code, lga_code
       HAVING count(*) >= ${AnalyticsService.SUPPRESSION_THRESHOLD}
        ORDER BY count(*) DESC
        LIMIT 50`,
      where.params,
    );
    return {
      generatedAt: new Date().toISOString(),
      granularity: 'WARD',
      suppressionThreshold: AnalyticsService.SUPPRESSION_THRESHOLD,
      hotspots: rows.map((row) => ({
        wardCode: row.ward_code,
        lgaCode: row.lga_code,
        incidentCount: Number(row.count),
        mostCommonType: row.top_type,
      })),
      note: 'Wards below the suppression threshold are omitted entirely.',
    };
  }

  async responseUnitPerformance(
    actor: AuthenticatedActor,
    filters: { from?: string; to?: string },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.authorize(actor, context, null);

    const where = new WhereBuilder().addRaw('d.arrived_at IS NOT NULL');
    if (filters.from !== undefined) where.add('d.dispatched_at >= ?::timestamptz', filters.from);
    if (filters.to !== undefined) where.add('d.dispatched_at <= ?::timestamptz', filters.to);

    const rows = await this.db.query<{
      unit_type: string;
      agency_id: string;
      dispatches: string;
      median_response: string | null;
    }>(
      `SELECT ru.type AS unit_type, ru.agency_id, count(*)::text AS dispatches,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (d.arrived_at - d.dispatched_at))
              )::text AS median_response
         FROM dispatch d JOIN response_unit ru ON ru.id = d.response_unit_id
         ${where.sql}
        GROUP BY ru.type, ru.agency_id
       HAVING count(*) >= ${AnalyticsService.SUPPRESSION_THRESHOLD}
        ORDER BY count(*) DESC`,
      where.params,
    );
    return {
      generatedAt: new Date().toISOString(),
      suppressionThreshold: AnalyticsService.SUPPRESSION_THRESHOLD,
      // Grouped by unit type and agency, never by individual responder: this
      // measures service capacity, not people.
      byUnitTypeAndAgency: rows.map((row) => ({
        unitType: row.unit_type,
        agencyId: row.agency_id,
        dispatches: Number(row.dispatches),
        medianDispatchToArrivalSeconds: numberOrNull(row.median_response),
      })),
    };
  }

  async missingPersonTrends(
    actor: AuthenticatedActor,
    filters: { from?: string; to?: string },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.authorize(actor, context, null);
    const where = new WhereBuilder();
    if (filters.from !== undefined) where.add('created_at >= ?::timestamptz', filters.from);
    if (filters.to !== undefined) where.add('created_at <= ?::timestamptz', filters.to);

    const [byStatus, byMonth, resolution] = await Promise.all([
      this.db.query<{ bucket: string; count: string }>(
        `SELECT status AS bucket, count(*)::text AS count FROM missing_person ${where.sql} GROUP BY status`,
        where.params,
      ),
      this.db.query<{ bucket: string; count: string }>(
        `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS bucket, count(*)::text AS count
           FROM missing_person ${where.sql} GROUP BY 1 ORDER BY 1`,
        where.params,
      ),
      this.db.queryOne<{ median_hours: string | null; resolved: string }>(
        `SELECT percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600
                )::text AS median_hours,
                count(*) FILTER (WHERE resolved_at IS NOT NULL)::text AS resolved
           FROM missing_person ${where.sql}`,
        where.params,
      ),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      suppressionThreshold: AnalyticsService.SUPPRESSION_THRESHOLD,
      byStatus: suppress(byStatus),
      byMonth: suppress(byMonth),
      medianHoursToResolution: numberOrNull(resolution?.median_hours),
      casesResolved: Number(resolution?.resolved ?? 0),
    };
  }

  private async authorize(
    actor: AuthenticatedActor,
    context: RequestContext,
    lgaCode: string | null,
  ): Promise<void> {
    await this.policy.authorize({
      actor,
      action: 'ANALYTICS_VIEW',
      purpose: 'STATISTICAL_ANALYSIS',
      resource: {
        type: 'ANALYTICS_AGGREGATE',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: null,
        lgaCode,
      },
      context,
    });
  }
}

interface Bucket {
  bucket: string | null;
  count: string;
}

function suppress(rows: readonly Bucket[]): {
  buckets: { bucket: string; count: number }[];
  suppressedBuckets: number;
  suppressedRecords: number;
} {
  const buckets: { bucket: string; count: number }[] = [];
  let suppressedBuckets = 0;
  let suppressedRecords = 0;
  for (const row of rows) {
    const count = Number(row.count);
    if (count < AnalyticsService.SUPPRESSION_THRESHOLD) {
      suppressedBuckets += 1;
      suppressedRecords += count;
      continue;
    }
    buckets.push({ bucket: row.bucket ?? 'UNSPECIFIED', count });
  }
  return { buckets, suppressedBuckets, suppressedRecords };
}

function numberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}
