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
] as const;
export type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['SMS', 'EMAIL', 'PUSH', 'IN_APP', 'DASHBOARD'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SUPPRESSED',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
