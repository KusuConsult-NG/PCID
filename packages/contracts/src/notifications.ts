import type { Classification } from './classification';

/**
 * Notification vocabulary, and the rule that shapes all of it
 * (master system prompt §33, §58).
 *
 * The rule: **a message sent outside the platform carries a notice, never the
 * thing it is about.**
 *
 * An SMS crosses a network in clear text, arrives at a number that may have
 * been reassigned, and is read by whoever is holding the handset - on a lock
 * screen, in front of whoever is standing there. An email lands in a mailbox
 * somebody else may have access to. Neither is a place to say "the Police
 * Command opened your record under a criminal investigation", however true and
 * however much the resident is entitled to know it.
 *
 * So the same event produces different text on different channels. In the
 * portal, behind authentication, the resident gets the sentence in full. On SMS
 * they get "there is something waiting for you", and they sign in to read it.
 * That is not the platform being coy: it is the difference between telling
 * somebody something and broadcasting it.
 */

export const NOTIFICATION_CHANNELS = ['SMS', 'EMAIL', 'PUSH', 'IN_APP', 'DASHBOARD'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Channels that leave the platform and travel over somebody else's network. */
export const EXTERNAL_CHANNELS: readonly NotificationChannel[] = Object.freeze([
  'EMAIL',
  'SMS',
  'PUSH',
]);

export function isExternalChannel(channel: NotificationChannel): boolean {
  return EXTERNAL_CHANNELS.includes(channel);
}

export const NOTIFICATION_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SUPPRESSED',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Why nothing was sent. Suppression is an outcome, not a failure. */
export const SUPPRESSION_REASONS = [
  'NO_ADDRESS',
  'CLASSIFICATION_TOO_HIGH_FOR_CHANNEL',
  'RECIPIENT_INACTIVE',
  'DUPLICATE',
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const NOTIFICATION_TEMPLATES = [
  'RECORD_ACCESSED',
  'CORRECTION_DECIDED',
  'CORRECTION_RAISED',
  'ACCESS_REQUEST_DECIDED',
  'ACCESS_REQUEST_AWAITING',
  'BREAK_GLASS_USED',
  'BREAK_GLASS_REVIEW_DUE',
  'CREDENTIAL_ISSUED',
  'CREDENTIAL_REVOKED',
  'IDENTITY_ALERT_RAISED',
  'ACCOUNT_PASSPHRASE_ISSUED',
  'PORTAL_WELCOME',
  'GENERAL',
] as const;
export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

export interface TemplateDefinition {
  readonly key: NotificationTemplate;
  /**
   * The classification of what this notification is *about*.
   *
   * A channel may carry a notice about anything; it may carry the detail only
   * when the channel is at least as protected as the subject matter. In
   * practice that means the detail travels in the portal and nowhere else.
   */
  readonly classification: Classification;
  /** Channels this template may be delivered on at all. */
  readonly channels: readonly NotificationChannel[];
  /** Short line for an external channel. Carries no personal information. */
  readonly notice: string;
  readonly description: string;
}

/**
 * Every notice below is written to be safe on a lock screen.
 *
 * The test in `services/api/test/unit/notifications.test.ts` holds this to it:
 * a notice that contains an interpolation placeholder fails, because a
 * placeholder is where a name or a case number would end up.
 */
export const NOTIFICATION_TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = Object.freeze([
  {
    key: 'RECORD_ACCESSED',
    classification: 'SENSITIVE',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    notice: 'There is a new entry in your Plateau Citizen Portal access history.',
    description: 'An agency opened this resident’s record under a stated purpose.',
  },
  {
    key: 'CORRECTION_DECIDED',
    classification: 'CONFIDENTIAL',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    notice: 'Your correction request has been decided. Sign in to the portal to read it.',
    description: 'A correction request was approved or refused.',
  },
  {
    key: 'CORRECTION_RAISED',
    classification: 'CONFIDENTIAL',
    channels: ['IN_APP', 'EMAIL'],
    notice: 'A correction to your record has been requested. Sign in to the portal to read it.',
    description: 'An officer raised a correction on this resident’s behalf.',
  },
  {
    key: 'ACCESS_REQUEST_DECIDED',
    classification: 'INTERNAL',
    channels: ['IN_APP', 'EMAIL'],
    notice: 'An access request you raised has been decided.',
    description: 'An officer’s request for withheld fields was approved or denied.',
  },
  {
    key: 'ACCESS_REQUEST_AWAITING',
    classification: 'INTERNAL',
    channels: ['IN_APP', 'EMAIL'],
    notice: 'An access request is waiting for your decision.',
    description: 'A request has entered an approver’s queue.',
  },
  {
    key: 'BREAK_GLASS_USED',
    classification: 'SENSITIVE',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    notice: 'Emergency access has been used in your command. A review is due within 24 hours.',
    description: 'A supervisor is told the moment break-glass is used.',
  },
  {
    key: 'BREAK_GLASS_REVIEW_DUE',
    classification: 'SENSITIVE',
    channels: ['IN_APP', 'EMAIL'],
    notice: 'A break-glass review is overdue.',
    description: 'The mandatory post-event review has not been recorded in time.',
  },
  {
    key: 'CREDENTIAL_ISSUED',
    classification: 'CONFIDENTIAL',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    notice: 'Your Plateau Citizen credential is ready.',
    description: 'A credential was issued or replaced.',
  },
  {
    key: 'CREDENTIAL_REVOKED',
    classification: 'CONFIDENTIAL',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    notice: 'A Plateau Citizen credential in your name has been cancelled.',
    description: 'A credential was reported lost or otherwise revoked.',
  },
  {
    key: 'IDENTITY_ALERT_RAISED',
    classification: 'SENSITIVE',
    channels: ['IN_APP', 'EMAIL'],
    notice: 'There is something waiting for you in the Plateau Citizen Portal.',
    description: 'An identity integrity alert was raised about this resident’s records.',
  },
  {
    key: 'ACCOUNT_PASSPHRASE_ISSUED',
    classification: 'CONFIDENTIAL',
    channels: ['IN_APP', 'EMAIL'],
    // Never the passphrase itself, on any channel. It is handed over in person.
    notice: 'An account has been created for you. Your passphrase is given to you in person.',
    description: 'An account was created at a desk.',
  },
  {
    key: 'PORTAL_WELCOME',
    classification: 'INTERNAL',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    notice: 'Your Plateau Citizen Portal account is ready.',
    description: 'Portal credentials were issued in person.',
  },
  {
    key: 'GENERAL',
    classification: 'INTERNAL',
    channels: ['IN_APP'],
    notice: 'There is something waiting for you in the Plateau Citizen Portal.',
    description: 'Anything that has not been given a template of its own yet.',
  },
]);

const BY_KEY: ReadonlyMap<NotificationTemplate, TemplateDefinition> = new Map(
  NOTIFICATION_TEMPLATE_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function notificationTemplate(key: NotificationTemplate): TemplateDefinition {
  const definition = BY_KEY.get(key);
  if (definition === undefined) throw new Error(`No notification template ${key}`);
  return definition;
}

/**
 * Which channels a template may actually go out on.
 *
 * `IN_APP` and `DASHBOARD` stay inside the platform behind authentication, so
 * they carry the detail. Everything else carries the notice.
 */
export function channelsFor(key: NotificationTemplate): readonly NotificationChannel[] {
  return notificationTemplate(key).channels;
}
