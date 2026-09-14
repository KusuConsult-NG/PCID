/**
 * The retention catalogue (master system prompt §21, §68).
 *
 * Storage limitation was the one data-protection principle in this platform
 * with nothing behind it. `retention_policy` columns carried a default,
 * `location_retention_until` was set on write, `docs/privacy.md` printed a table
 * of schedules - and no code anywhere read any of it. A retention schedule that
 * nothing applies is not a schedule; it is a claim, and a regulator reading that
 * table would have been told the platform does something it does not do.
 *
 * This catalogue is the single source of truth for what is kept, for how long,
 * what happens when the period ends, and why the period is that. It is a
 * catalogue rather than a set of constants for the same reason the field
 * catalogue is: the answer to "what does this platform hold about me, and until
 * when" should be readable in one place by somebody who cannot read TypeScript,
 * and the code should be obliged to match it rather than free to drift from it.
 *
 * Two properties hold across every entry:
 *
 *  - **Nothing here can erase the audit trail.** `audit_event` is append-only at
 *    the database level - three triggers refuse UPDATE, DELETE and TRUNCATE -
 *    so the accountability record survives every retention rule by construction
 *    rather than by the sweep being careful. Erasing it would also break the
 *    hash chain for every record after it, which is the point.
 *  - **Nothing here decides on its own that a record may go.** A policy names a
 *    period; the sweep applies it; the ledger records what it did. A record with
 *    no policy is kept.
 */

/** What happens when a retention period ends. */
export const RETENTION_DISPOSITIONS = ['DELETE', 'REDACT', 'KEEP'] as const;
export type RetentionDisposition = (typeof RETENTION_DISPOSITIONS)[number];

export const RETENTION_POLICY_KEYS = [
  'CITIZEN_IDENTITY_LONG_TERM',
  'AUDIT_LONG_TERM',
  'SECURITY_CASE_LEGAL',
  'INCIDENT_STANDARD',
  'SESSION_OPERATIONAL',
  'SIGN_IN_ATTEMPT_OPERATIONAL',
  'CREDENTIAL_TOKEN_EPHEMERAL',
  'NOTIFICATION_CONTENT',
  'NOTIFICATION_ATTEMPT_OPERATIONAL',
  'OFFLINE_RELEASE_LEDGER',
  'RATE_COUNTER_EPHEMERAL',
] as const;
export type RetentionPolicyKey = (typeof RETENTION_POLICY_KEYS)[number];

export interface RetentionPolicy {
  readonly key: RetentionPolicyKey;
  /** What this covers, in the words a Data Protection Officer would use. */
  readonly holds: string;
  readonly disposition: RetentionDisposition;
  /** How long it is kept. `null` only for KEEP. */
  readonly retainDays: number | null;
  /**
   * Why that period and not another. Required on every entry: a retention
   * schedule where the durations have no stated reason cannot be defended to a
   * regulator, and cannot be revised by anyone who did not choose them.
   */
  readonly basis: string;
  /** For REDACT: the columns emptied. The row itself stays. */
  readonly redacts?: readonly string[];
}

/**
 * A day, in the units the sweep works in. Named because "90" appears in the
 * privacy notice, in this catalogue and in a database default, and the three
 * are supposed to be the same number.
 */
const DAYS = 1;

export const RETENTION_POLICIES: readonly RetentionPolicy[] = Object.freeze([
  {
    key: 'CITIZEN_IDENTITY_LONG_TERM',
    holds: 'The identity register: a resident’s record and their Plateau Citizen ID.',
    disposition: 'KEEP',
    retainDays: null,
    basis:
      'A statutory identity register is not subject to erasure, and a PCID allocation is ' +
      'permanent by design - reissuing one to somebody else would make every historic record ' +
      'that names it ambiguous. A record can be suspended; it is not deleted.',
  },
  {
    key: 'AUDIT_LONG_TERM',
    holds: 'Every audit event, and the hash chain that proves none has been altered.',
    disposition: 'KEEP',
    retainDays: null,
    basis:
      'The accountability record outlives what it records: a resident asking who read their ' +
      'file three years ago is asking a question the platform must still be able to answer. ' +
      'Deleting one event would also break the chain for every event after it, and the ' +
      'database refuses the deletion outright.',
  },
  {
    key: 'SECURITY_CASE_LEGAL',
    holds: 'Investigation case files, their subjects, notes and documents.',
    disposition: 'KEEP',
    retainDays: null,
    basis:
      'Disposal of evidence is a decision for the agency holding the case, under its own legal ' +
      'retention, taken case by case. No automated sweep destroys material that may be ' +
      'disclosable in a prosecution.',
  },
  {
    key: 'INCIDENT_STANDARD',
    holds: 'Where an emergency happened: coordinates and the address text on an incident.',
    disposition: 'REDACT',
    retainDays: 90 * DAYS,
    redacts: ['latitude', 'longitude', 'address_text'],
    basis:
      'An incident location is an observation about an event, not a standing record about a ' +
      'person (§16). That the event happened, what kind it was and how it was handled is a ' +
      'public-safety record worth keeping; exactly where somebody was at the time stops being ' +
      'one once the response and any review of it are over. Ninety days is the default; the ' +
      'date is set on each incident when it is created, so a case that needs longer sets it.',
  },
  {
    key: 'SESSION_OPERATIONAL',
    holds: 'Expired and revoked sessions, with the address and browser they were opened from.',
    disposition: 'DELETE',
    retainDays: 30 * DAYS,
    basis:
      'A session record past its expiry authorises nothing; what it still holds is an address ' +
      'and a user agent, which is personal data with no remaining purpose. Thirty days is long ' +
      'enough to investigate a reported account compromise and short enough that the platform ' +
      'is not keeping a movement history nobody asked for.',
  },
  {
    key: 'SIGN_IN_ATTEMPT_OPERATIONAL',
    holds: 'Sign-in attempts: the identifier tried, whether it worked, and the address.',
    disposition: 'DELETE',
    retainDays: 90 * DAYS,
    basis:
      'Ninety days is the window in which a credential-stuffing campaign against this platform ' +
      'would be investigated, and the attempt log is what that investigation reads. Beyond it ' +
      'the rows are a list of who signed in from where, which is exactly what an attacker who ' +
      'reached the database would most like to find.',
  },
  {
    key: 'CREDENTIAL_TOKEN_EPHEMERAL',
    holds: 'The one-time tokens behind a resident’s QR credential.',
    disposition: 'DELETE',
    retainDays: 7 * DAYS,
    basis:
      'These expire in five minutes and authorise nothing afterwards. They are kept a week only ' +
      'so that a disputed verification can be explained, and the verification itself is in the ' +
      'audit trail, which is where the answer actually lives.',
  },
  {
    key: 'NOTIFICATION_CONTENT',
    holds: 'The text of a notice sent to a resident or an officer, and the address it went to.',
    disposition: 'REDACT',
    retainDays: 90 * DAYS,
    redacts: ['subject', 'body', 'recipient_address'],
    basis:
      'That somebody was told something, and when, is part of the record - a resident disputing ' +
      'a decision needs to be able to show they were never notified. The wording and the ' +
      'telephone number it went to are not: they are a second copy of personal data whose ' +
      'purpose ended when the message arrived. The row stays and says its content was erased.',
  },
  {
    key: 'NOTIFICATION_ATTEMPT_OPERATIONAL',
    holds: 'Per-attempt delivery outcomes from the messaging gateways.',
    disposition: 'DELETE',
    retainDays: 90 * DAYS,
    basis:
      'Gateway diagnostics. They answer "why did this not arrive" for as long as anybody is ' +
      'still asking, and the notification row keeps the outcome that matters.',
  },
  {
    key: 'OFFLINE_RELEASE_LEDGER',
    holds: 'The record that a bundle was released to a device: which device, how many people.',
    disposition: 'DELETE',
    retainDays: 365 * DAYS,
    basis:
      'A year, because the question this ledger answers - what had left the platform when that ' +
      'phone was lost - is asked long after the event, sometimes by an investigation into the ' +
      'loss. It never held the bundle’s contents, so what expires here is a set of counts.',
  },
  {
    key: 'RATE_COUNTER_EPHEMERAL',
    holds: 'Counters behind the limits on sensitive actions.',
    disposition: 'DELETE',
    retainDays: 7 * DAYS,
    basis:
      'A spent counter window is arithmetic, not a record. It is kept a week so that a ' +
      'threshold alert can be explained by the counts that produced it.',
  },
]);

const BY_KEY: ReadonlyMap<RetentionPolicyKey, RetentionPolicy> = new Map(
  RETENTION_POLICIES.map((policy) => [policy.key, policy]),
);

export function retentionPolicy(key: RetentionPolicyKey): RetentionPolicy {
  const found = BY_KEY.get(key);
  if (found === undefined) {
    // Unreachable through the type, and deliberate at runtime: a sweep that met
    // a policy it does not recognise must stop rather than guess a period.
    throw new Error(`unknown retention policy: ${key}`);
  }
  return found;
}

export function isRetentionPolicyKey(value: unknown): value is RetentionPolicyKey {
  return typeof value === 'string' && (RETENTION_POLICY_KEYS as readonly string[]).includes(value);
}

/** Policies the sweep acts on. The rest are kept, and say why. */
export function enforceableRetentionPolicies(): readonly RetentionPolicy[] {
  return RETENTION_POLICIES.filter((policy) => policy.disposition !== 'KEEP');
}

/**
 * What a redacted column is set to, where the column cannot be null.
 *
 * A row that says its content was erased is better than a row that is blank:
 * blank reads as "nothing was ever sent", which is a different and wrong answer
 * to the question a resident is asking.
 */
export const RETENTION_REDACTED_PLACEHOLDER =
  'Erased under the retention schedule; the record that it was sent remains.';

/**
 * The most rows one rule may touch in one sweep.
 *
 * Bounded because the first sweep on a deployment that has been running for a
 * year meets a year of rows at once, and a single unbounded DELETE against a few
 * million of them takes a statement timeout with it - which the load harness
 * found the hard way in `--remove`. The sweep reports that more remain and the
 * next run continues.
 */
export const RETENTION_BATCH_LIMIT = 5_000;
