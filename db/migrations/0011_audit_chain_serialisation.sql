-- 0011 Make the audit hash chain hold under concurrency
-- (master system prompt §25).
--
-- The chain trigger read its predecessor with an unlocked
--
--   SELECT hash INTO v_prev FROM audit_event ORDER BY seq DESC LIMIT 1;
--
-- Two transactions inserting at the same time both read the same tail, both
-- wrote the same prev_hash, and the chain forked: the later row's prev_hash no
-- longer equalled the earlier row's hash, and verify_audit_chain() reported
-- "prev_hash does not match the preceding row".
--
-- Nothing had been tampered with, which is what makes it serious rather than
-- cosmetic. The API is horizontally scaled and one page of the government portal
-- issues five authorised calls at once, so concurrent audit writes are the
-- ordinary case. Measured on sixteen simultaneous inserts, fifteen of the
-- sixteen landed on a broken chain; with the fix, none did. A mechanism that fires
-- during normal traffic is worse than none: it teaches the person reviewing it
-- to dismiss the alarm.
--
-- Two things have to be true for the chain to hold, and neither was:
--
--  1. Each writer must read the hash of the row that really precedes it. A
--     plain SELECT cannot: under READ COMMITTED the trigger runs inside the
--     INSERT's snapshot, so it sees the tail as it stood before any concurrent
--     writer committed - and an advisory lock does not help, because waiting
--     does not move the snapshot. `SELECT ... FOR UPDATE` does: PostgreSQL
--     re-reads the latest committed version of a locked row after the wait.
--
--  2. The order the chain was forged in must be the order it is verified in.
--     `seq` was a bigserial, and sequence values are handed out before commit,
--     so a transaction could hold a lower seq and commit later. Verification
--     walks by seq, so it would disagree with the chain even with (1) fixed.
--     The trigger now issues seq itself, from the same locked row, which makes
--     the two orders the same by construction.
--
-- The cost is accepted: audit inserts serialise on one row. An identity platform
-- that cannot say for certain whether its own log has been altered has nothing
-- else worth optimising.

-- One row, holding the end of the chain: the hash of the last link and the
-- number the next one will carry.
CREATE TABLE audit_chain_head (
  only_row  boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  next_seq  bigint NOT NULL,
  hash      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO audit_chain_head (only_row, next_seq, hash)
SELECT
  true,
  coalesce((SELECT max(seq) FROM audit_event), 0) + 1,
  coalesce((SELECT hash FROM audit_event ORDER BY seq DESC LIMIT 1), repeat('0', 64));

-- The sequence number is part of the chain now, so it comes from the chain head
-- and not from a sequence anybody could call.
ALTER TABLE audit_event ALTER COLUMN seq DROP DEFAULT;
DROP SEQUENCE IF EXISTS audit_event_seq_seq;

CREATE OR REPLACE FUNCTION audit_event_chain()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER so the chain head can be updated by this function and by
-- nothing else: the application role is granted no privilege on that table at
-- all, and so cannot choose its own predecessor even with a direct connection.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text;
  v_seq  bigint;
BEGIN
  SELECT h.hash, h.next_seq INTO v_prev, v_seq
    FROM audit_chain_head h
   WHERE h.only_row
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'the audit chain head is missing; refusing to write an unchained record';
  END IF;

  NEW.seq := v_seq;
  NEW.prev_hash := v_prev;
  NEW.hash := encode(digest(NEW.prev_hash || audit_event_payload(NEW), 'sha256'), 'hex');

  UPDATE audit_chain_head
     SET next_seq = v_seq + 1, hash = NEW.hash, updated_at = now()
   WHERE only_row;

  RETURN NEW;
END;
$$;

-- Nobody but the trigger touches the head, and the trigger runs as its owner.
REVOKE ALL ON audit_chain_head FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_app') THEN
    REVOKE ALL ON audit_chain_head FROM pcid_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcid_readonly') THEN
    GRANT SELECT ON audit_chain_head TO pcid_readonly;
  END IF;
END;
$$;
