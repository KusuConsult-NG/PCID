# Disaster recovery

## Objectives

|                      | Target                                            | How it is met                                                   |
| -------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| **RPO**              | ≤ 5 minutes                                       | Continuous WAL archiving with point-in-time recovery            |
| **RTO**              | ≤ 60 minutes (identity and emergency paths)       | Standby promotion; stateless API instances                      |
| **Backup retention** | 35 days point-in-time, 12 months of monthly fulls | Managed backups plus off-site copies                            |
| **Restore drill**    | Quarterly, to a scratch environment               | Documented below; the mechanism is covered by an automated test |

The identity and emergency identification paths are the priority. A responder at
a roadside needs the registry; analytics can wait.

## What has to survive

1. **The citizen registry and PCID allocations.** Allocations are append-only —
   losing them would risk reissuing an identifier, which the design forbids.
2. **The audit trail**, with its hash chain intact, so a restored system can still
   prove its history was not altered.
3. **The agency registry, roles and entitlements.** Without them the platform
   comes back with nobody able to use it.
4. Open incidents, cases and missing-person records.

Projections of other agencies' records are recoverable by re-synchronising, so
they are the least urgent.

## Backups

Managed automated backups with WAL archiving to separate, encrypted off-site
storage. Encryption keys are held in the secrets manager, not alongside the
backups.

For an explicit dump, the platform's own test uses exactly this:

```bash
pg_dump --format=custom --no-owner --file pcid-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL"
```

## Restoring

```bash
createdb pcid_restored
pg_restore --no-owner --dbname "postgres://.../pcid_restored" pcid-<timestamp>.dump
```

Then **verify before trusting it**:

```sql
-- The chain must be intact. No rows is the passing result.
SELECT * FROM verify_audit_chain();

-- Counts against the source.
SELECT count(*) FROM citizen;
SELECT count(*) FROM pcid_allocation;
SELECT count(*) FROM audit_event;

-- The protections must have come back with the schema, not been lost.
UPDATE audit_event SET action = 'TAMPERED' WHERE seq = 1;   -- must error
DELETE FROM pcid_allocation WHERE true;                      -- must error

-- The restored database must be at a known schema version.
SELECT version, name, applied_at FROM schema_migration ORDER BY version;
```

`verify_audit_chain()` is defined in the database, so verification does not depend
on the application being available — which is exactly the situation a restore
tends to be performed in.

## This is tested, not asserted

[`services/api/test/integration/disaster-recovery.test.ts`](../services/api/test/integration/disaster-recovery.test.ts)
runs on every build. It populates a database with citizens and audited activity,
takes a real `pg_dump`, restores into a fresh database, and checks that the
registry, allocations and audit events all survived, that the chain still
verifies, that the append-only triggers came back, and that migration bookkeeping
is present.

A second test proves the verification is not vacuous: it disables the trigger,
edits a historical row, and asserts the chain detects it.

A backup nobody has restored is a hope, not a control.

## Scenarios

### Primary database failure

1. Confirm the primary is unrecoverable; check standby replication lag.
2. Promote the standby.
3. Repoint `DATABASE_URL` and restart instances (they are stateless).
4. Verify readiness, then run `verify_audit_chain()`.
5. Record the incident per [incident-response.md](incident-response.md).

Expected RTO: 15–30 minutes.

### Data corruption or accidental destructive change

1. Take the platform out of service at the gateway — do not let writes continue
   on top of bad data.
2. Identify the last good point in time from the audit trail and the operator log.
3. Restore to that point into a **new** database. Never restore over the original
   until the restore is verified.
4. Verify as above, including the chain.
5. Repoint and return to service.
6. The audit trail between the corruption and the recovery point is the record of
   what was lost; review it with the DPO.

Expected RTO: 45–60 minutes.

### Complete region loss

1. Restore the most recent off-site backup into the recovery region.
2. Apply WAL to the latest consistent point.
3. Deploy the API from the image registry; supply keys from the secrets manager.
4. Verify, then repoint DNS.

Expected RTO: 2–4 hours, which exceeds the standing objective. Reducing it
requires a warm standby in a second region — a funding decision, recorded here so
it is not mistaken for an oversight.

### Key loss

Losing `SECRET_ENCRYPTION_KEY` makes stored TOTP seeds undecryptable. Every
government user must re-enrol an authenticator. The registry itself is unaffected
— this is why secrets are not encrypted with that key.

Losing `TOKEN_SIGNING_KEY` invalidates all sessions; everyone signs in again. No
data is lost.

Both keys must be recoverable from the secrets manager's own backup, and must
never be stored with the database backups.

## Quarterly drill

1. Restore the most recent production backup into an isolated environment.
2. Run the verification queries above.
3. Start the API against it and exercise: sign in, verify a PCID, fetch an
   emergency profile, search the audit trail.
4. Record the wall-clock time to a working system.
5. Destroy the environment.
6. File the result, including anything that did not go to plan.

A drill that is never written up did not happen.
