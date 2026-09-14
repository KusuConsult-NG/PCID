/**
 * Measurement for the load harness.
 *
 * Deliberately percentile-first. A mean response time hides exactly the thing a
 * control room cares about: not how the median request went, but how the worst
 * one in a hundred went, because that is the one where somebody is waiting for an
 * ambulance. Every sample is kept rather than reservoir-sampled - a ten-minute
 * run at a few hundred requests a second is a few hundred thousand numbers, which
 * costs a few megabytes and buys an exact p99.
 */

export interface Outcome {
  readonly scenario: string;
  readonly status: number;
  /** Whether the status is one the scenario expects. A 403 can be a pass. */
  readonly ok: boolean;
  readonly durationMs: number;
  readonly startedAtMs: number;
  readonly error?: string;
}

export interface ScenarioSummary {
  readonly scenario: string;
  readonly requests: number;
  readonly failures: number;
  readonly errorRate: number;
  readonly throughputPerSecond: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly statuses: Readonly<Record<string, number>>;
}

export interface RunSummary {
  readonly startedAt: string;
  readonly durationSeconds: number;
  readonly virtualUsers: number;
  readonly requests: number;
  readonly failures: number;
  readonly errorRate: number;
  readonly throughputPerSecond: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly scenarios: readonly ScenarioSummary[];
  readonly statuses: Readonly<Record<string, number>>;
}

/**
 * The percentile of a sample set, by nearest-rank on a sorted copy.
 *
 * Nearest-rank rather than interpolation: "the p99 is 240ms" should mean a
 * request that actually took 240ms happened, not a number between two that did.
 */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (fraction <= 0) return sorted[0] as number;
  if (fraction >= 1) return sorted[sorted.length - 1] as number;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export class Recorder {
  private readonly outcomes: Outcome[] = [];
  private firstAtMs: number | null = null;
  private lastAtMs = 0;

  record(outcome: Outcome): void {
    this.outcomes.push(outcome);
    if (this.firstAtMs === null || outcome.startedAtMs < this.firstAtMs) {
      this.firstAtMs = outcome.startedAtMs;
    }
    const finished = outcome.startedAtMs + outcome.durationMs;
    if (finished > this.lastAtMs) this.lastAtMs = finished;
  }

  get size(): number {
    return this.outcomes.length;
  }

  /**
   * Discard everything before `fromMs`. The driver calls this after warm-up, so
   * the report does not include the requests that filled the connection pool,
   * planned every statement for the first time and warmed the buffer cache.
   */
  discardBefore(fromMs: number): void {
    const kept = this.outcomes.filter((outcome) => outcome.startedAtMs >= fromMs);
    this.outcomes.length = 0;
    this.outcomes.push(...kept);
    this.firstAtMs = kept.length === 0 ? null : Math.min(...kept.map((o) => o.startedAtMs));
    this.lastAtMs = kept.reduce((max, o) => Math.max(max, o.startedAtMs + o.durationMs), 0);
  }

  summarise(virtualUsers: number, startedAt: string): RunSummary {
    const windowSeconds = Math.max(
      0.001,
      (this.lastAtMs - (this.firstAtMs ?? this.lastAtMs)) / 1000,
    );
    const byScenario = new Map<string, Outcome[]>();
    for (const outcome of this.outcomes) {
      const list = byScenario.get(outcome.scenario);
      if (list === undefined) byScenario.set(outcome.scenario, [outcome]);
      else list.push(outcome);
    }

    const scenarios = [...byScenario.entries()]
      .map(([scenario, outcomes]) => summariseOutcomes(scenario, outcomes, windowSeconds))
      .sort((a, b) => b.requests - a.requests);

    const all = summariseOutcomes('all', this.outcomes, windowSeconds);
    return {
      startedAt,
      durationSeconds: Number(windowSeconds.toFixed(1)),
      virtualUsers,
      requests: all.requests,
      failures: all.failures,
      errorRate: all.errorRate,
      throughputPerSecond: all.throughputPerSecond,
      p50: all.p50,
      p95: all.p95,
      p99: all.p99,
      max: all.max,
      scenarios,
      statuses: all.statuses,
    };
  }
}

function summariseOutcomes(
  scenario: string,
  outcomes: readonly Outcome[],
  windowSeconds: number,
): ScenarioSummary {
  const sorted = outcomes.map((outcome) => outcome.durationMs).sort((a, b) => a - b);
  const failures = outcomes.filter((outcome) => !outcome.ok).length;
  const statuses: Record<string, number> = {};
  for (const outcome of outcomes) {
    const key =
      outcome.status === 0 ? (outcome.error ?? 'transport error') : String(outcome.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  return {
    scenario,
    requests: outcomes.length,
    failures,
    errorRate: outcomes.length === 0 ? 0 : Number((failures / outcomes.length).toFixed(5)),
    throughputPerSecond: Number((outcomes.length / windowSeconds).toFixed(2)),
    p50: round(percentile(sorted, 0.5)),
    p90: round(percentile(sorted, 0.9)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    statuses,
  };
}

function round(value: number): number {
  return Number(value.toFixed(1));
}

/** A fixed-width table, so a run's output can be pasted into a report unchanged. */
export function formatSummary(summary: RunSummary): string {
  const header = [
    `Started            ${summary.startedAt}`,
    `Measured window    ${summary.durationSeconds}s (warm-up excluded)`,
    `Virtual users      ${summary.virtualUsers}`,
    `Requests           ${summary.requests} (${summary.throughputPerSecond}/s)`,
    `Failures           ${summary.failures} (${(summary.errorRate * 100).toFixed(3)}%)`,
    `Latency            p50 ${summary.p50}ms  p95 ${summary.p95}ms  p99 ${summary.p99}ms  max ${summary.max}ms`,
    '',
  ];

  const columns: readonly [string, number][] = [
    ['scenario', 34],
    ['requests', 9],
    ['req/s', 8],
    ['fail%', 7],
    ['p50', 8],
    ['p90', 8],
    ['p95', 8],
    ['p99', 8],
    ['max', 9],
  ];
  const line = columns.map(([, width]) => '-'.repeat(width)).join(' ');
  const titles = columns.map(([title, width]) => title.padEnd(width)).join(' ');
  const rows = summary.scenarios.map((scenario) =>
    [
      scenario.scenario.padEnd(34),
      String(scenario.requests).padStart(9),
      scenario.throughputPerSecond.toFixed(1).padStart(8),
      (scenario.errorRate * 100).toFixed(2).padStart(7),
      `${scenario.p50}`.padStart(8),
      `${scenario.p90}`.padStart(8),
      `${scenario.p95}`.padStart(8),
      `${scenario.p99}`.padStart(8),
      `${scenario.max}`.padStart(9),
    ].join(' '),
  );

  const statuses = Object.entries(summary.statuses)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `  ${status.padEnd(20)} ${count}`)
    .join('\n');

  return [...header, titles, line, ...rows, '', 'Responses by status', statuses, ''].join('\n');
}

export interface Budget {
  readonly maxErrorRate: number;
  readonly maxP95Ms: number;
  readonly maxP99Ms: number;
}

export interface BudgetBreach {
  readonly measure: string;
  readonly observed: number;
  readonly allowed: number;
}

/**
 * Compare a run against a budget. The CLI exits non-zero on a breach, so this can
 * stand in a pipeline as a gate rather than as a number somebody reads.
 */
export function breaches(summary: RunSummary, budget: Budget): BudgetBreach[] {
  const found: BudgetBreach[] = [];
  if (summary.errorRate > budget.maxErrorRate) {
    found.push({
      measure: 'error rate',
      observed: summary.errorRate,
      allowed: budget.maxErrorRate,
    });
  }
  if (summary.p95 > budget.maxP95Ms) {
    found.push({ measure: 'p95 (ms)', observed: summary.p95, allowed: budget.maxP95Ms });
  }
  if (summary.p99 > budget.maxP99Ms) {
    found.push({ measure: 'p99 (ms)', observed: summary.p99, allowed: budget.maxP99Ms });
  }
  return found;
}
