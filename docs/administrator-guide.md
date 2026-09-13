# Administrator guide

For the platform administrator and for agency administrators.

## What your role is, and what it is not

`PLATFORM_ADMINISTRATOR` grants administration of the platform: agencies, users,
roles, policies, reference data, integrations and system settings.

It grants **no access to citizen data at all** — not to a citizen record, not to a
search, not to an emergency profile, not to a case. This is not an oversight and
not a setting: the policy engine reads only the resolved action list, and no
administrative role resolves a citizen-data action. Tests hold it at both the
engine and the HTTP boundary.

If you need citizen data to do a job, that job needs a different account with the
appropriate role, and that account's access will be audited like anyone's.

You also cannot administer your own entitlements. A separation-of-duty gate
refuses it, so widening your own access requires another administrator.

## First install

```bash
BOOTSTRAP_ADMIN_EMAIL=you@example.gov.ng \
BOOTSTRAP_ADMIN_PASSWORD='a long passphrase you have not used elsewhere' \
npm run db:bootstrap --workspace services/api
```

This prints an authenticator provisioning URI and ten recovery codes, **once**.
Scan the URI now; store the recovery codes somewhere offline and physically
secure. There is no second chance and no reset path that does not involve
database access.

## Registering an agency

An agency is created INACTIVE with no data-sharing agreement, so registering one
grants nothing.

```http
POST /api/v1/agencies
{
  "code": "PLT-POLICE",
  "name": "Plateau State Police Command",
  "category": "SECURITY",
  "jurisdictionScope": "STATE",
  "maxClassification": "LAW_ENFORCEMENT_RESTRICTED",
  "contactEmail": "...", "dataProtectionOfficer": "...", "administratorName": "..."
}
```

Then bring it into service:

```http
PATCH /api/v1/agencies/{id}/status
{ "status": "ACTIVE", "dataSharingAgreement": "SIGNED",
  "dataSharingExpiresAt": "2027-03-31T23:59:59Z" }
```

**Set the expiry.** The agreement is evaluated on every request, so access stops
the moment it lapses — no job to run, nothing to remember.

`maxClassification` is a ceiling on what the agency can ever receive, applied
alongside each individual's clearance. The lower of the two wins.

### The law-enforcement compartment

Clearance and compartment are different things. A HIGHLY_RESTRICTED clearance does
not confer law-enforcement material; the agency must hold the compartment.

```http
POST /api/v1/agencies/{id}/compartments/law-enforcement
{ "legalBasis": "Approved under the state data-sharing framework for ..." }
```

Only SECURITY and JUSTICE categories are eligible. The legal basis is mandatory,
at least 20 characters, and recorded — write something a reviewer can act on, not
"approved".

## Creating users

```http
POST /api/v1/users
{
  "email": "investigator@police.plateaustate.gov.ng",
  "fullName": "...",
  "agencyId": "...",
  "roles": ["INVESTIGATOR"],
  "clearance": "LAW_ENFORCEMENT_RESTRICTED",
  "jurisdictionScope": "LGA",
  "jurisdictionLgaCodes": ["PL-JNO", "PL-JSO"],
  "temporaryPassword": "..."
}
```

Returns the authenticator enrolment material once. The account **cannot reach
citizen data until the authenticator is confirmed** — the engine refuses a
government user who is not MFA-enrolled — so hand it over promptly and have them
confirm it at `POST /api/v1/users/me/mfa/confirm`.

The temporary password must meet policy: 14+ characters, mixed case, a digit, and
no part of the person's own name or email address.

### Choosing roles

Grant the narrowest role that covers the work. Roles compose, so two narrow roles
are better than one broad one.

| Role                      | For                                                                     |
| ------------------------- | ----------------------------------------------------------------------- |
| `REGISTRATION_OFFICER`    | Registration desks; duplicate review; issuing portal credentials        |
| `VERIFICATION_OFFICER`    | Service counters that only confirm a presented credential               |
| `MDA_OFFICER`             | Ordinary ministry users; property, business and licence registers       |
| `REVENUE_OFFICER`         | Revenue service; held separately so a ministry desk gets no tax records |
| `INVESTIGATOR`            | Case-bound investigative access                                         |
| `INCIDENT_OFFICER`        | Incident management, including recording unidentified persons           |
| `DISPATCHER`              | Dispatch and response coordination                                      |
| `EMERGENCY_RESPONDER`     | Field responders; emergency profile only                                |
| `MISSING_PERSON_OFFICER`  | Missing and unidentified person registers                               |
| `SUPERVISOR`              | Approvals, break-glass review, match confirmation, case closure         |
| `ANALYST`                 | Aggregates only; no record access                                       |
| `AUDITOR`                 | Logs, not the data behind them                                          |
| `DATA_PROTECTION_OFFICER` | Oversight, correction review, access transparency                       |
| `SECURITY_ADMINISTRATOR`  | User administration within one security agency                          |

### Jurisdiction and access windows

A jurisdiction of `LGA` or `WARD` confines the account geographically; records
outside it are refused, and break glass is the documented exception.

An access window confines an account to its shift, expressed in the state's civil
time. Use it for accounts that genuinely only operate on a shift — it is a strong
control against a credential used at 3 a.m. from elsewhere.

## Roles and permissions

Roles live in the database and are reconciled on every deploy from the
declarations in `@pcid/contracts`. A role that gains an action in code gains it on
the next deploy; one that loses an action loses it. Editing `role_action` by hand
will be reverted, so an entitlement change is a code change with a test and a
review — which is what it should be.

## Day to day

**The break-glass review queue** (`GET /api/v1/break-glass/review-queue`) is the
one thing to look at daily. Every grant must be reviewed within 24 hours, and the
queue flags overdue ones. An officer cannot review their own.

**Alerts.** Identity integrity alerts describe _records_, not people — a
registration matching an existing one. Security alerts describe _account
activity_ — unusual search volume, repeated refusals. Neither is an accusation;
both need a person to look.

**Agreement expiry.** Review `data_sharing_expires_at` monthly. A lapse is
correct behaviour, but a surprise one strands an agency.

**The audit chain**: `GET /api/v1/audit/verify` should always report intact. If it
ever does not, treat it as a P1 and follow
[incident-response.md](incident-response.md).

## Suspending access

| To stop                    | Do                                                                          |
| -------------------------- | --------------------------------------------------------------------------- |
| One account                | `UPDATE government_user SET status = 'SUSPENDED'`                           |
| One account's sessions     | `UPDATE user_session SET revoked_at = now() WHERE government_user_id = ...` |
| A whole agency             | `PATCH /api/v1/agencies/{id}/status { "status": "SUSPENDED" }`              |
| Citizen data for an agency | Set `dataSharingAgreement` to `SUSPENDED`                                   |
| A break-glass grant        | `UPDATE break_glass_grant SET status = 'REVOKED'`                           |

All take effect on the agency's or account's next request, because entitlements
are read per request rather than carried in the token.

## Reference data

LGAs, wards and communities are seeded and updated by migration. The seeded ward
list is a placeholder structure of three wards per LGA; replace it with the State
Independent Electoral Commission's reference data before a pilot.
