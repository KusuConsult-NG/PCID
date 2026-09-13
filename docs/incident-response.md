# Incident response

For security and data-protection incidents affecting the platform. For emergency
_operations_ — dispatching to a road accident — see
[emergency-response-guide.md](emergency-response-guide.md).

## Severity

|        | Meaning                                               | Examples                                                           |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------ |
| **P1** | Citizen data exposed, or the identity service is down | Unauthorised bulk access; registry unavailable; audit chain broken |
| **P2** | A control has failed but no exposure is confirmed     | Authorisation bug found; credentials leaked; break-glass misuse    |
| **P3** | Degraded or suspicious                                | Sustained alerts; integration failing; unusual search volume       |
| **P4** | Minor                                                 | Isolated failures, cosmetic issues                                 |

P1 and P2 page immediately and notify the Data Protection Officer at the same
time as the technical responder. The DPO's clock starts when the incident is
identified, not when it is fixed.

## First hour

1. **Record the time** and open an incident record.
2. **Contain**, favouring the smallest action that stops the harm:
   - suspend an account: `UPDATE government_user SET status = 'SUSPENDED'`
   - suspend an agency (closes every account in it at the next request):
     `PATCH /api/v1/agencies/{id}/status { "status": "SUSPENDED" }`
   - revoke sessions: `UPDATE user_session SET revoked_at = now() WHERE ...`
   - revoke a break-glass grant: `UPDATE break_glass_grant SET status = 'REVOKED'`
   - if necessary, take the API out of service at the gateway
3. **Preserve evidence.** Do not delete anything. The audit trail cannot be
   altered, which is the point — snapshot the database before remediating.
4. **Scope it** from the audit trail (see below).
5. **Notify**: DPO for anything touching citizen data; the affected agency's own
   DPO; the platform owner for P1.

## Scoping from the audit trail

Everything below is available to an auditor through `/api/v1/audit/events`, and
directly in SQL.

```sql
-- What did this account do, and to whom?
SELECT occurred_at, action, outcome, purpose, subject_pcid, fields_released,
       case_number, incident_number, ip_address
  FROM audit_event
 WHERE actor_id = '<user id>' AND occurred_at > now() - interval '30 days'
 ORDER BY occurred_at DESC;

-- Who touched this person's record?
SELECT occurred_at, actor_display, agency_code, action, purpose, fields_released
  FROM audit_event WHERE subject_pcid = 'PL-...' ORDER BY occurred_at DESC;

-- Every break-glass use, and whether it was reviewed.
SELECT bg.reference, u.full_name, bg.reason, bg.access_count,
       bg.reviewed_at, bg.review_note
  FROM break_glass_grant bg JOIN government_user u ON u.id = bg.user_id
 WHERE bg.granted_at > now() - interval '30 days' ORDER BY bg.granted_at DESC;

-- Refused attempts, which often show intent more clearly than successes.
SELECT occurred_at, actor_display, agency_code, action, subject_pcid, decision_reasons
  FROM audit_event WHERE outcome = 'DENIED' AND occurred_at > now() - interval '7 days'
 ORDER BY occurred_at DESC;

-- Has history been altered? No rows is the passing answer.
SELECT * FROM verify_audit_chain();
```

Because `fields_released` is recorded per event, the scope of an exposure is
knowable to the field, not merely to the record — which is what a notification to
an affected resident has to say.

## By scenario

### Suspected insider misuse

The most likely incident, and the one the platform is built to answer.

1. Pull the account's 30-day activity. Look at the declared purposes, the cases
   and incidents relied upon, and the ratio of searches to authorised record
   views.
2. Check whether each investigative access sits under a case the officer was
   assigned to, and whether the subject was properly associated with it.
3. Check break-glass uses against their stated reasons.
4. Suspend the account if the pattern is not explained by assigned work.
5. Hand to the employing agency; the platform's role is evidence, not discipline.
6. Identify affected residents from `subject_pcid` and refer to the DPO.

### Credential compromise

1. Suspend the account and revoke its sessions.
2. Review activity since the suspected compromise; a foothold usually shows as
   access outside the account's normal purposes or hours.
3. Reset the password and re-enrol the authenticator — the old one may be
   compromised too.
4. If several accounts in one agency are affected, suspend the agency.

### Authorisation defect

1. Determine which requests it affected: search the audit trail for the action and
   resource type over the whole period the defect existed.
2. Fix it in the policy engine, **with a test that fails without the fix**. Every
   authorisation change lands with a test.
3. Deploy, then re-run the scoping query to confirm no further occurrences.
4. Refer any exposure to the DPO.

### Broken audit chain

Treat as P1. It means either a database-level compromise or a defect in chaining.

1. Take the platform out of service.
2. `SELECT * FROM verify_audit_chain()` names the first bad row; everything before
   it is still trustworthy.
3. Restore to a point before the break into a separate database and compare.
4. Do not "repair" the chain. A repaired chain proves nothing.

### Data exposure through an integration

1. Disable the data source: `UPDATE data_source SET mode = 'DISABLED'`.
2. Determine what the projection held and who read it, from the audit trail.
3. Notify the source agency — it is their record.

## Data breach notification

Where personal data has been exposed, the DPO assesses against the Nigeria Data
Protection Act and the state's obligations. The platform provides:

- the affected residents (`subject_pcid`);
- the fields exposed (`fields_released`) — not just the records;
- who accessed them, from which agency, under which stated purpose;
- the exact times;
- whether break glass was involved and whether it was reviewed.

## After

Within five working days of closure:

- a timeline from the audit trail;
- what failed, stated as a control rather than a person where possible;
- what was changed, including the test that now covers it;
- what would have caught it sooner.

Add the detection to [`security.test.ts`](../services/api/test/integration/security.test.ts)
or the policy suite. An incident that does not leave a test behind will happen
again.

## Contacts

| Role                    | Responsibility                           |
| ----------------------- | ---------------------------------------- |
| Platform on-call        | First response, containment              |
| Data Protection Officer | Assessment, notification, citizen impact |
| Platform owner          | Authorises taking the service out of use |
| Agency DPO              | Their agency's own staff and records     |

Fill in the current names and numbers for the deployment; they are deliberately
not held in the repository.
