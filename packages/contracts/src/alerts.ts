/** Smart alert engine vocabulary (master system prompt §31, §32). */

export const ALERT_CATEGORIES = [
  'IDENTITY_INTEGRITY',
  'SECURITY',
  'DATA_SECURITY',
  'POTENTIAL_MATCH',
  'EMERGENCY_DISPATCH',
  'OPERATIONAL',
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'ACTIONED',
  'DISMISSED_FALSE_POSITIVE',
  'CLOSED',
] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/**
 * Alert titles describe *records and events*, never people (master system prompt
 * §31, §65). "Identity Integrity Alert", never "Fraudster". An alert is a prompt
 * for a human review, not a finding.
 */
export const ALERT_RULE_KINDS = [
  'DUPLICATE_IDENTITY_ATTRIBUTES',
  'REPEATED_FAILED_ADMIN_ACCESS',
  'UNUSUAL_BULK_EXPORT',
  'UNUSUAL_SEARCH_VOLUME',
  'MISSING_PERSON_POTENTIAL_MATCH',
  'INCIDENT_RESPONSE_UNIT_NOTIFICATION',
  'BREAK_GLASS_INITIATED',
  'UNAUTHORISED_ACCESS_ATTEMPT',
  // Raised by a resident from the citizen portal (§17). Like every other alert,
  // these describe an event to be reviewed, not a finding about a person.
  'CITIZEN_REPORTED_IDENTITY_FRAUD',
  'CITIZEN_REPORTED_UNAUTHORISED_ACCESS',
] as const;
export type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];

// The notification channel and status vocabulary lived here, because alerts
// were the first thing in the platform that produced a notification. It is in
// `./notifications` now, alongside the templates that decide what each channel
// may carry.
export type { NotificationChannel, NotificationStatus } from './notifications';
export { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from './notifications';
