import { Database } from '../database/pool';
import { percentile } from './metrics';

/**
 * Two measurements a request-level load test cannot make (§81).
 *
 * **The audit chain's ceiling.** Every audited operation takes a row lock on the
 * single `audit_chain_head` row and holds it until its transaction commits
 * (0011). That is correct and it was chosen deliberately - a chain that forks
 * under concurrent writers is worse than no chain at all - but it means the whole
 * platform's audited write rate has one number, and it does not improve by adding
 * API instances. Nothing else the platform does matters if that number is below
 * the traffic. So it is measured directly, on its own, rather than inferred from
 * a request mix.
 *
 * **The access paths.** A load run on a quarter of a million records says what
 * happens on a quarter of a million records. What it cannot say is what happens
 * on four million. A plan that reaches its rows through an index still does at
 * four million; a sequential scan grows with the table. So the plans are read at
 * the seeded volume and reported, and the extrapolation rests on the shape of the
 * plan rather than on a straight line through two points.
 */

export interface ChainMeasurement {
  readonly concurrency: number;
  readonly inserts: number;
  readonly elapsedSeconds: number;
  readonly insertsPerSecond: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/**
 * Insert `inserts` audit rows across `concurrency` connections, all through the
 * ordinary chained path, and report the rate the chain sustained.
 */
export async function measureAuditChain(
  db: Database,
  concurrency: number,
  inserts: number,
): Promise<ChainMeasurement> {
  const perWorker = Math.max(1, Math.floor(inserts / concurrency));
  const samples: number[] = [];
  const started = Date.now();

  await Promise.all(
    Array.from({ length: concurrency }, async (_unused, worker) => {
      for (let index = 0; index < perWorker; index += 1) {
        const at = Date.now();
        await db.query(
          `INSERT INTO audit_event (
             action, outcome, actor_type, resource_type, correlation_id, detail, prev_hash, hash
           ) VALUES ('ADMIN_SYSTEM_MANAGE','PERMITTED','SYSTEM','SYSTEM',$1,$2::jsonb,'','')`,
          [`chain-probe-${worker}-${index}`, JSON.stringify({ probe: 'audit-chain' })],
        );
        samples.push(Date.now() - at);
      }
    }),
  );

  const elapsedSeconds = Math.max(0.001, (Date.now() - started) / 1000);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    concurrency,
    inserts: samples.length,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    insertsPerSecond: Number((samples.length / elapsedSeconds).toFixed(1)),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

export interface PlanMeasurement {
  readonly name: string;
  readonly rows: number;
  readonly planningMs: number;
  readonly executionMs: number;
  readonly topNode: string;
  /** Relations reached by a sequential scan, which is what does not extrapolate. */
  readonly sequentialScans: readonly string[];
  readonly indexes: readonly string[];
}

interface HotQuery {
  readonly name: string;
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * The queries behind the scenarios, as the services issue them. Kept here rather
 * than imported so a plan is read against the statement as written, including
 * the `count(*)` companions - a listing endpoint that pages cheaply and then
 * counts the whole result set expensively is a real and easily missed cost.
 */
export function hotQueries(sample: {
  readonly pcid: string;
  readonly displayName: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly dateOfBirth: string;
  readonly phone: string | null;
  readonly lgaCode: string;
  readonly userId: string | null;
}): readonly HotQuery[] {
  return [
    {
      name: 'counter search: name + date of birth',
      sql: `SELECT id, pcid, display_name FROM citizen
             WHERE status <> 'MERGED' AND display_name % $1 AND date_of_birth = $2::date
             ORDER BY display_name <-> $1 LIMIT 20 OFFSET 0`,
      params: [sample.displayName, sample.dateOfBirth],
    },
    {
      name: 'counter search: bounded count',
      sql: `SELECT count(*) FROM (SELECT 1 FROM citizen
             WHERE status <> 'MERGED' AND display_name % $1 AND date_of_birth = $2::date
             LIMIT 1001) AS bounded`,
      params: [sample.displayName, sample.dateOfBirth],
    },
    {
      name: 'search refused: name alone',
      // The refusal path. What has to be cheap is discovering that a search
      // matches more people than anybody could look through, not serving it.
      sql: `SELECT count(*) FROM (SELECT 1 FROM citizen
             WHERE status <> 'MERGED' AND display_name % $1 LIMIT 1001) AS bounded`,
      params: [sample.familyName],
    },
    {
      name: 'duplicate detection: candidate net',
      sql: `WITH candidate AS (
              SELECT id FROM citizen
               WHERE status <> 'MERGED' AND date_of_birth = $3::date AND family_name % $2
              UNION
              SELECT id FROM citizen
               WHERE $4::text IS NOT NULL AND status <> 'MERGED' AND phone_primary = $4
            )
            SELECT c.id, similarity(c.given_name, $1) AS g, similarity(c.family_name, $2) AS f
              FROM citizen c JOIN candidate ON candidate.id = c.id
             ORDER BY similarity(c.family_name, $2) DESC LIMIT 50`,
      params: [sample.givenName, sample.familyName, sample.dateOfBirth, sample.phone],
    },
    {
      name: 'citizen search: exact PCID',
      sql: `SELECT id, pcid, display_name FROM citizen WHERE status <> 'MERGED' AND pcid = $1`,
      params: [sample.pcid],
    },
    {
      name: 'citizen view: by PCID',
      sql: 'SELECT * FROM citizen WHERE pcid = $1',
      params: [sample.pcid],
    },
    {
      name: 'incident board: active only',
      sql: `SELECT id, incident_number, status, reported_at FROM incident
             WHERE status = ANY($1::text[])
             ORDER BY reported_at DESC LIMIT 25`,
      params: [['REPORTED', 'VERIFIED', 'DISPATCHED', 'ON_SCENE', 'CONTAINED']],
    },
    {
      name: 'incident board: count companion',
      sql: 'SELECT count(*) FROM incident WHERE status = ANY($1::text[])',
      params: [['REPORTED', 'VERIFIED', 'DISPATCHED', 'ON_SCENE', 'CONTAINED']],
    },
    {
      name: 'command map: bounding box',
      sql: `SELECT id, latitude, longitude FROM incident
             WHERE latitude IS NOT NULL AND longitude IS NOT NULL
               AND latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
               AND status = ANY($5::text[])`,
      params: [
        9.5,
        10.1,
        8.6,
        9.2,
        ['REPORTED', 'VERIFIED', 'DISPATCHED', 'ON_SCENE', 'CONTAINED'],
      ],
    },
    {
      name: 'citizen access history',
      sql: `SELECT seq, action, occurred_at FROM audit_event
             WHERE subject_pcid = $1 AND citizen_visibility = 'ACCESS_VISIBLE_TO_CITIZEN'
             ORDER BY occurred_at DESC LIMIT 25`,
      params: [sample.pcid],
    },
    {
      name: 'audit search: by action, newest first',
      sql: `SELECT seq, action, occurred_at FROM audit_event
             WHERE action = $1 ORDER BY occurred_at DESC LIMIT 50`,
      params: ['CITIZEN_VIEW'],
    },
    ...(sample.userId === null
      ? []
      : [
          {
            name: 'caseload: cases assigned to an officer',
            sql: `SELECT ic.id, ic.case_number FROM investigation_case ic
                   WHERE EXISTS (SELECT 1 FROM case_assignment ca
                                  WHERE ca.case_id = ic.id AND ca.user_id = $1
                                    AND ca.released_at IS NULL)
                   ORDER BY ic.opened_at DESC LIMIT 20`,
            params: [sample.userId],
          },
        ]),
  ];
}

export async function explainAll(
  db: Database,
  queries: readonly HotQuery[],
): Promise<PlanMeasurement[]> {
  const measurements: PlanMeasurement[] = [];
  for (const query of queries) {
    // Run once unmeasured so the comparison is between warm plans rather than
    // between one cold read and nine warm ones.
    await db.query(query.sql, query.params).catch(() => undefined);
    const rows = await db.query<Record<string, unknown>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
      query.params,
    );
    const payload = rows[0]?.['QUERY PLAN'] as unknown;
    const plan = (Array.isArray(payload) ? payload[0] : payload) as {
      Plan: PlanNode;
      'Planning Time'?: number;
      'Execution Time'?: number;
    };
    const sequentialScans: string[] = [];
    const indexes: string[] = [];
    walk(plan.Plan, (node) => {
      if (node['Node Type'] === 'Seq Scan' && typeof node['Relation Name'] === 'string') {
        sequentialScans.push(node['Relation Name']);
      }
      if (typeof node['Index Name'] === 'string') indexes.push(node['Index Name']);
    });
    measurements.push({
      name: query.name,
      rows: plan.Plan['Actual Rows'] ?? 0,
      planningMs: Number((plan['Planning Time'] ?? 0).toFixed(3)),
      executionMs: Number((plan['Execution Time'] ?? 0).toFixed(3)),
      topNode: plan.Plan['Node Type'],
      sequentialScans: [...new Set(sequentialScans)],
      indexes: [...new Set(indexes)],
    });
  }
  return measurements;
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  Plans?: PlanNode[];
}

function walk(node: PlanNode, visit: (node: PlanNode) => void): void {
  visit(node);
  for (const child of node.Plans ?? []) walk(child, visit);
}

export interface TableSize {
  readonly table: string;
  readonly rows: number;
  readonly totalBytes: number;
  readonly indexBytes: number;
}

/** What the dataset actually costs on disk, table by table. */
export async function tableSizes(db: Database): Promise<TableSize[]> {
  const rows = await db.query<{
    table_name: string;
    row_estimate: string;
    total_bytes: string;
    index_bytes: string;
  }>(
    `SELECT c.relname AS table_name,
            c.reltuples::bigint::text AS row_estimate,
            pg_total_relation_size(c.oid)::text AS total_bytes,
            pg_indexes_size(c.oid)::text AS index_bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 12`,
  );
  return rows.map((row) => ({
    table: row.table_name,
    rows: Number(row.row_estimate),
    totalBytes: Number(row.total_bytes),
    indexBytes: Number(row.index_bytes),
  }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
