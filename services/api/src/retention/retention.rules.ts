import {
  RETENTION_REDACTED_PLACEHOLDER,
  enforceableRetentionPolicies,
  retentionPolicy,
  type RetentionDisposition,
  type RetentionPolicyKey,
} from '@pcid/contracts';

/**
 * How each retention policy is applied, and to what.
 *
 * A closed list, deliberately. The catalogue in `@pcid/contracts` says what is
 * kept and for how long; this says which rows that means and what statement
 * erases them, and nothing outside this file may erase anything on a schedule.
 * `retention.test.ts` asserts the two match in both directions, so a policy
 * added to the catalogue with no rule behind it fails the build rather than
 * quietly becoming another period nothing applies - which is the exact defect
 * this phase exists to fix.
 *
 * Three properties every rule holds to:
 *
 *  - **It names its cutoff in SQL, from one parameter.** The sweep computes one
 *    instant per rule from the policy's period and passes it in. A rule that
 *    computed its own cutoff could disagree with the catalogue, which is the
 *    only number a Data Protection Officer will ever read.
 *  - **It is bounded.** Every statement takes a row limit. The first sweep on a
 *    deployment that has been running a year meets a year of rows at once.
 *  - **It touches one table, and that table holds no citizen record, no case and
 *    no audit event.** The database enforces the last part as well: `pcid_app`
 *    has DELETE on exactly the tables below.
 */
export interface RetentionRule {
  readonly policy: RetentionPolicyKey;
  readonly table: string;
  readonly disposition: Exclude<RetentionDisposition, 'KEEP'>;
  /**
   * How many rows are past their period right now. Takes the cutoff; returns
   * one row with a `due` count. Bounded so that a count against a large backlog
   * cannot itself become the slow query - it answers "at least this many".
   */
  readonly due: string;
  /** Erase up to `$2` rows past the `$1` cutoff. Returns one row: `erased`. */
  readonly erase: string;
  /**
   * What the period is measured from, in the words the interface shows. The
   * catalogue says "30 days"; this says 30 days from what.
   */
  readonly measuredFrom: string;
  /**
   * How `$1` is arrived at, and it is not a detail.
   *
   * `AGE` rules compare a timestamp on the row against `now - retainDays`: the
   * period is applied at sweep time, from the catalogue.
   *
   * `DUE_DATE` rules compare a date the row already carries against `now`,
   * because the period was applied when the row was written. An incident's
   * `location_retention_until` is set at creation, so a case that needs the
   * location longer sets a later date and the sweep honours it - and subtracting
   * the period a second time at sweep time would keep every location for twice
   * as long as the schedule says.
   */
  readonly cutoff: 'AGE' | 'DUE_DATE';
}

/**
 * Count what is due, but never scan more than this to do it.
 *
 * A retention page that takes twenty seconds to load because it counted nine
 * million spent sessions is a page nobody opens. The count says "1000+" past
 * this, which is the same answer for the reader's purpose.
 */
export const RETENTION_DUE_COUNT_CEILING = 1000;

function boundedCount(table: string, predicate: string): string {
  return `SELECT count(*)::int AS due
            FROM (SELECT 1 FROM ${table} WHERE ${predicate} LIMIT ${RETENTION_DUE_COUNT_CEILING + 1}) bounded`;
}

/**
 * Delete up to a limit, and report how many actually went.
 *
 * No `ORDER BY`: any due rows will do, and the next sweep takes the rest. That
 * is what lets the append-ordered tables be served by a BRIN index a few
 * kilobytes in size rather than a btree the size of the table.
 */
function boundedDelete(table: string, key: string, predicate: string): string {
  return `WITH doomed AS (
            SELECT ${key} FROM ${table} WHERE ${predicate} LIMIT $2
          ), gone AS (
            DELETE FROM ${table} t USING doomed d WHERE ${key
              .split(', ')
              .map((column) => `t.${column} = d.${column}`)
              .join(' AND ')} RETURNING 1
          )
          SELECT count(*)::int AS erased FROM gone`;
}

export const RETENTION_RULES: readonly RetentionRule[] = Object.freeze([
  {
    policy: 'INCIDENT_STANDARD',
    table: 'incident',
    disposition: 'REDACT',
    measuredFrom: 'the retention date set on the incident when it was created',
    cutoff: 'DUE_DATE',
    due: boundedCount(
      'incident',
      'location_erased_at IS NULL AND location_retention_until IS NOT NULL ' +
        'AND location_retention_until < $1',
    ),
    // The incident survives; where it happened does not. `location_source` is
    // left alone: how a coordinate was obtained is a fact about the platform's
    // own behaviour that an oversight review still needs after the coordinate
    // has gone.
    erase: `WITH doomed AS (
              SELECT id FROM incident
               WHERE location_erased_at IS NULL
                 AND location_retention_until IS NOT NULL
                 AND location_retention_until < $1
               LIMIT $2
            ), gone AS (
              UPDATE incident SET latitude = NULL, longitude = NULL, address_text = NULL,
                     location_erased_at = now(), updated_at = now()
               WHERE id IN (SELECT id FROM doomed) RETURNING 1
            )
            SELECT count(*)::int AS erased FROM gone`,
  },
  {
    policy: 'NOTIFICATION_CONTENT',
    table: 'notification',
    disposition: 'REDACT',
    measuredFrom: 'when the notice was created',
    cutoff: 'AGE',
    due: boundedCount(
      'notification',
      'content_erased_at IS NULL AND created_at < $1 ' +
        "AND status IN ('DELIVERED','SENT','FAILED','SUPPRESSED')",
    ),
    // Only a message that has stopped moving. A queued or sending notice past
    // its period is a stuck message, and emptying its body would send an empty
    // one rather than erase anything.
    erase: `WITH doomed AS (
              SELECT id FROM notification
               WHERE content_erased_at IS NULL AND created_at < $1
                 AND status IN ('DELIVERED','SENT','FAILED','SUPPRESSED')
               LIMIT $2
            ), gone AS (
              UPDATE notification
                 SET subject = NULL,
                     body = '${RETENTION_REDACTED_PLACEHOLDER}',
                     recipient_address = NULL,
                     content_erased_at = now(),
                     updated_at = now()
               WHERE id IN (SELECT id FROM doomed) RETURNING 1
            )
            SELECT count(*)::int AS erased FROM gone`,
  },
  {
    policy: 'SESSION_OPERATIONAL',
    table: 'user_session',
    disposition: 'DELETE',
    measuredFrom: 'when the session expired',
    cutoff: 'AGE',
    due: boundedCount('user_session', 'expires_at < $1'),
    // `replaced_by` is self-referential, so a rotated chain has to go oldest
    // first or a delete meets its own foreign key. It is ON DELETE SET NULL, so
    // it does not block - but taking the whole chain in one batch is what stops
    // a sweep leaving half a rotation behind.
    erase: boundedDelete('user_session', 'id', 'expires_at < $1'),
  },
  {
    policy: 'SIGN_IN_ATTEMPT_OPERATIONAL',
    table: 'login_attempt',
    disposition: 'DELETE',
    measuredFrom: 'when the attempt was made',
    cutoff: 'AGE',
    due: boundedCount('login_attempt', 'attempted_at < $1'),
    erase: boundedDelete('login_attempt', 'id', 'attempted_at < $1'),
  },
  {
    policy: 'CREDENTIAL_TOKEN_EPHEMERAL',
    table: 'credential_verification_token',
    disposition: 'DELETE',
    measuredFrom: 'when the token expired',
    cutoff: 'AGE',
    due: boundedCount('credential_verification_token', 'expires_at < $1'),
    erase: boundedDelete('credential_verification_token', 'id', 'expires_at < $1'),
  },
  {
    policy: 'NOTIFICATION_ATTEMPT_OPERATIONAL',
    table: 'notification_delivery_attempt',
    disposition: 'DELETE',
    measuredFrom: 'when the attempt was made',
    cutoff: 'AGE',
    due: boundedCount('notification_delivery_attempt', 'attempted_at < $1'),
    erase: boundedDelete('notification_delivery_attempt', 'id', 'attempted_at < $1'),
  },
  {
    policy: 'OFFLINE_RELEASE_LEDGER',
    table: 'offline_release',
    disposition: 'DELETE',
    measuredFrom: 'when the bundle was released',
    cutoff: 'AGE',
    due: boundedCount('offline_release', 'released_at < $1'),
    // Through a function, not a DELETE. Migration 0015 grants the application
    // SELECT and INSERT on this table and nothing else, so the record of what
    // left the platform cannot be removed by the code that writes it; 0016 adds
    // one SECURITY DEFINER function that erases by the schedule's cutoff. A
    // grant of DELETE would have been simpler and would have handed the whole
    // application a way to remove the evidence.
    erase: 'SELECT retention_erase_offline_releases($1, $2) AS erased',
  },
  {
    policy: 'RATE_COUNTER_EPHEMERAL',
    table: 'sensitive_action_counter',
    disposition: 'DELETE',
    measuredFrom: 'the start of the counting window',
    cutoff: 'AGE',
    due: boundedCount('sensitive_action_counter', 'window_start < $1'),
    erase: boundedDelete(
      'sensitive_action_counter',
      'user_id, action, window_start',
      'window_start < $1',
    ),
  },
]);

/** The tables a scheduled sweep may touch. Nothing else is reachable from here. */
export const RETENTION_TABLES: readonly string[] = Object.freeze(
  [...new Set(RETENTION_RULES.map((rule) => rule.table))].sort(),
);

export function retentionRuleFor(policy: RetentionPolicyKey): RetentionRule {
  const found = RETENTION_RULES.find((rule) => rule.policy === policy);
  if (found === undefined) {
    throw new Error(`no retention rule implements ${policy}`);
  }
  return found;
}

/**
 * The cutoff for a policy: the instant before which a row is past its period.
 *
 * Computed from the catalogue's period and nothing else, so the number a Data
 * Protection Officer reads in the schedule is the number the statement uses.
 */
export function retentionCutoff(rule: RetentionRule, now: Date): Date {
  if (rule.cutoff === 'DUE_DATE') return now;
  const days = retentionPolicy(rule.policy).retainDays;
  if (days === null) {
    throw new Error(`${rule.policy} is kept; it has no cutoff`);
  }
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Policies the sweep will act on this run, in catalogue order. */
export function enforceablePolicies(): readonly RetentionPolicyKey[] {
  return enforceableRetentionPolicies().map((policy) => policy.key);
}
