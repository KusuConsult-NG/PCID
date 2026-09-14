-- 0012 Notification delivery (master system prompt §33, §58).
--
-- The queue existed and nothing drained it. This is what a worker needs to do
-- that safely: somewhere to record which template a message came from, when it
-- may next be attempted, why nothing was sent where nothing was, and what
-- happened on each attempt.

-- Which template produced this message. The template decides what each channel
-- is allowed to carry, so storing it is what lets an operator check afterwards
-- that an SMS said what SMS is permitted to say.
ALTER TABLE notification
  ADD COLUMN template_key text NOT NULL DEFAULT 'GENERAL';

-- Backoff. A worker claims rows whose time has come; a row that failed waits.
ALTER TABLE notification
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

-- Why nothing was sent. Suppression is an outcome, not a failure: a resident
-- with no telephone number recorded is not an error condition, and a queue that
-- retries them forever is a queue nobody reads.
ALTER TABLE notification
  ADD COLUMN suppressed_reason text CHECK (suppressed_reason IS NULL OR suppressed_reason IN
    ('NO_ADDRESS','CLASSIFICATION_TOO_HIGH_FOR_CHANNEL','RECIPIENT_INACTIVE','DUPLICATE'));

-- Idempotency. A producer that retries - a request replayed, a sync run twice -
-- must not send the same person the same thing twice.
ALTER TABLE notification
  ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX notification_dedupe_idx ON notification (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- The worker claims with FOR UPDATE SKIP LOCKED and moves the row to SENDING
-- inside the same transaction, so two workers never take the same message. A
-- process that dies mid-send leaves a row in SENDING; `next_attempt_at` is what
-- brings it back, rather than a lock nobody can clear.
DROP INDEX IF EXISTS notification_status_idx;
CREATE INDEX notification_due_idx ON notification (next_attempt_at)
  WHERE status IN ('QUEUED', 'SENDING');
CREATE INDEX notification_status_queued_idx ON notification (status, queued_at);

/*
 * What happened on each attempt.
 *
 * Separate from the notification itself because `last_error` only ever holds
 * the most recent one, and "it failed three times with a timeout and once with
 * a rejected number" is a different operational problem from "it failed four
 * times with a timeout". It records the outcome and the gateway's reference,
 * never the message body: the body is already on the notification, and copying
 * it here would put the same personal information in two places with two
 * retention rules.
 */
CREATE TABLE notification_delivery_attempt (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id     uuid NOT NULL REFERENCES notification (id) ON DELETE CASCADE,
  attempt             integer NOT NULL,
  channel             text NOT NULL,
  outcome             text NOT NULL CHECK (outcome IN ('SENT','FAILED','SUPPRESSED')),
  detail              text,
  provider_reference  text,
  attempted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, attempt)
);
CREATE INDEX notification_attempt_notification_idx
  ON notification_delivery_attempt (notification_id, attempt);

-- Append-only in privilege as well as in intent: an attempt that happened
-- happened, and an operator reading "it failed four times" must be reading the
-- four rows rather than a number somebody could quietly revise.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_app') THEN
    GRANT SELECT, INSERT ON notification_delivery_attempt TO pcid_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON notification_delivery_attempt FROM pcid_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_readonly') THEN
    -- Outcomes and timings, which is what a delivery-rate question needs. The
    -- body is on the notification and stays there.
    GRANT SELECT ON notification_delivery_attempt TO pcid_readonly;
  END IF;
END $$;
