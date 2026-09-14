# API

Base path `/api/v1`. The full machine-readable contract is served at
`/api/v1/docs` and written to `docs/openapi.json` by `npm run openapi`.

This document covers the conventions every endpoint follows. Read it once and the
endpoint list becomes predictable.

## Authentication

```http
POST /api/v1/auth/login          { email, password }        → AAL1 session
POST /api/v1/auth/mfa/verify     { sessionId, code }        → AAL2 session
POST /api/v1/auth/refresh        { refreshToken }           → rotated session
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Present the access token as `Authorization: Bearer <token>`.

A password alone establishes **AAL1**, which authorises nothing that touches
citizen data: the policy engine refuses a government user who is not MFA-enrolled.
The second factor raises the session to **AAL2** for a short window; approvals,
administration and break glass require it and it is re-derived on every request.

`GET /auth/me` returns the caller's **resolved action list** — the same list the
policy engine reads. An interface should disable what the account genuinely
cannot do rather than inferring it from role names.

## Purpose is a required parameter

Every endpoint that reads citizen or citizen-linked information takes
`purpose`. It is checked against the action and against each field, and written to
the audit record.

```http
GET /api/v1/citizens/PL-4K7T9-QM2XB-7H?purpose=SERVICE_DELIVERY
```

There is no default and no general-browsing value. A purpose the action does not
permit is refused before any data is touched.

## References that carry authority

Investigative and emergency access is bound to a case or an incident, supplied as
a query parameter:

```http
GET /api/v1/citizens/{pcid}?purpose=CRIMINAL_INVESTIGATION&caseRef=CASE-2026-00928
GET /api/v1/citizens/{pcid}/emergency-profile?incidentRef=INC-2026-000123
GET /api/v1/citizens/{pcid}?purpose=EMERGENCY_RESPONSE&incidentRef=INC-2026-000123&breakGlassRef=BG-2026-00007
```

For an investigative purpose the person must additionally have been associated
with the case (`POST /cases/{ref}/subjects`), which is itself audited and carries
a written justification.

## Responses say what was withheld

A record response separates what was released from what was deliberately not:

```json
{
  "data": { "pcid": "PL-...", "displayName": "...", "lgaCode": "PL-JNO" },
  "restrictedFields": ["nin", "emergencyMedicalNotes", "lawEnforcementMarkers"]
}
```

The Citizen 360 view does the same at card level:

```json
{
  "cards": [
    { "key": "IDENTITY", "status": "RELEASED", "items": [ ... ], "restrictedFields": [] },
    { "key": "PUBLIC_SAFETY", "status": "RESTRICTED",
      "reason": "No role held by this account grants MISSING_PERSON_VIEW." }
  ]
}
```

Render restricted cards as "Restricted information". Omitting them lets an officer
mistake an absent card for an absent record.

## Linked records carry provenance

```json
{
  "data": { "propertyId": "PL/JN/2000", "address": "...", "sourceAgencyId": "..." },
  "provenance": {
    "sourceAgencyId": "...",
    "sourceSystem": "Lands Registry Core",
    "sourceRecordId": "PRP-0001",
    "sourceUpdatedAt": "2026-01-05T00:00:00.000Z",
    "lastSyncedAt": "2026-03-04T09:12:00.000Z",
    "verificationStatus": "SOURCE_CONFIRMED",
    "stale": false
  }
}
```

Show `stale` in the interface. An officer acting on a vehicle alert needs to know
how old it is.

## Errors

```json
{
  "error": {
    "code": "CASE_REFERENCE_REQUIRED",
    "message": "This purpose requires the case the access is being made under.",
    "correlationId": "6f1c...",
    "details": [{ "path": "dateOfBirth", "message": "Invalid date" }]
  }
}
```

| Code                          | Status | Meaning                                                       |
| ----------------------------- | ------ | ------------------------------------------------------------- |
| `VALIDATION_FAILED`           | 400    | The request could not be accepted; `details` names the fields |
| `UNAUTHENTICATED`             | 401    | No valid session                                              |
| `MFA_REQUIRED`                | 401    | The account has not confirmed an authenticator                |
| `STEP_UP_REQUIRED`            | 403    | Re-authenticate before continuing                             |
| `CASE_REFERENCE_REQUIRED`     | 403    | Supply the case this access is made under                     |
| `INCIDENT_REFERENCE_REQUIRED` | 403    | Supply the incident                                           |
| `APPROVAL_REQUIRED`           | 403    | A requested field needs supervisor approval                   |
| `ACCESS_DENIED`               | 403    | Refused for a reason it is safe to state                      |
| `NOT_FOUND_OR_NOT_PERMITTED`  | 404    | The record does not exist, or is not available                |
| `CONFLICT`                    | 409    | The record is not in a state that allows this                 |
| `RATE_LIMITED`                | 429    | Too many requests                                             |
| `ACCOUNT_LOCKED`              | 423    | Locked after repeated failures                                |
| `INTEGRATION_UNAVAILABLE`     | 503    | A source system could not be reached                          |

**404 is deliberately ambiguous.** A record that does not exist and one the caller
may not see return the same answer, so the API cannot be used to discover who is
registered. The precise reason is in the audit record.

**403 is deliberately specific**, and only where it is safe: these are reachable
only by someone who already holds the case or incident, so telling them what is
missing leaks nothing and lets them put it right.

## Correlation

Send `x-correlation-id` and it is echoed on the response, written to the operator
log and stored on the audit record. Omit it and one is generated. Quote it in
support requests — it ties a complaint, a log line and an audit row together
without using personal data.

## Pagination

`limit` (1–100, default 25) and `offset`. Responses carry `total`. A larger page
size is a validation error, not a silently clamped value.

## Rate limits

A general per-account ceiling, a tighter one on searches that fails closed, and a
separate limit on second-factor attempts. Sustained searching also raises a
security alert for review — describing the account's activity, never the people
searched for.

The general ceiling is applied in the authentication guard, so it cannot be
forgotten on a new controller, and it is keyed on the account rather than on an
address: a ceiling keyed on an address turns one busy officer into an outage for
the whole office behind their gateway. It fails **open** if the counter store is
unreachable, deliberately — the limiters that guard credentials fail closed, this
one does not, because a Redis incident must not take emergency response offline.

Sign-in is not governed by it. An unauthenticated request has no account to key
on, and the sign-in path has its own limits: per identifier, and per address on
_failed_ attempts only.

## Endpoint groups

| Group                    | Path                                                        | Purpose                                             |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------- |
| Authentication           | `/auth/*`                                                   | Sign in, second factor, rotation, sign out          |
| Citizens                 | `/citizens/*`                                               | Search, view, Citizen 360, registration, duplicates |
| Verification             | `/verification/pcid`, `/verification/credential`            | Confirm a presented identifier or scanned code      |
| Emergency                | `/incidents/*`, `/dispatches/*`, `/response-units/*`        | Incidents, dispatch, units                          |
| Emergency identification | `/citizens/{pcid}/emergency-profile`                        | Minimum necessary profile                           |
| Cases                    | `/cases/*`                                                  | Cases, subjects, assignments, closure               |
| Missing persons          | `/missing-persons/*`, `/unidentified-persons`, `/matches/*` | Registers and matching                              |
| Authorisation            | `/access-requests/*`, `/break-glass/*`                      | Approvals and break glass                           |
| Linked records           | `/vehicles/*`, `/properties/*`                              | Records other agencies own                          |
| Citizen portal           | `/me/*`                                                     | Own record, credential, contacts, history, security |
| Oversight                | `/correction-requests/*`, `/alerts/*`                       | Correction and alert review queues                  |
| Audit                    | `/audit/*`                                                  | Search and chain verification                       |
| Retention                | `/retention/*`                                              | The schedule, what is overdue, and what was erased  |
| Analytics                | `/analytics/*`                                              | Aggregates with small-number suppression            |
| Administration           | `/agencies/*`, `/users/*`                                   | Registry, user administration, your own account     |
| Integrations             | `/integrations/*`                                           | Data sources and synchronisation                    |
| Operations               | `/health/*`                                                 | Liveness and readiness                              |

## A device may keep almost nothing

`POST /me/devices` registers the device a request came from and returns a secret,
once. Present it as `x-device-token` on the two routes that release something for
a device to keep: `GET /me/offline-card` (a resident's own identifier and name)
and `GET /incidents/{reference}/offline-bundle` (the people already attached to a
live incident the caller is attached to).

The secret **authenticates nothing**. It travels with an ordinary authenticated
session and says only which registered device that session is being used from, so
that what the device holds can be bounded and taken back. A request carrying it
without a session is unauthenticated like any other.

Every person in a bundle is produced by the ordinary emergency-profile path, one
at a time, each authorised and each audited — so a bundle cannot contain anything
its holder could not have read on screen, and a resident's own access history
shows both the read and the fact that it left on a device.

`DELETE /me/devices/{deviceId}` ends a device: its sessions are revoked, its
releases are marked invalid, and it is refused anything further.
`GET /me/offline-releases/{releaseId}` is what a client asks on reconnecting —
an unknown release, an expired one and a revoked device all answer the same way,
because a client that cannot tell them apart still behaves correctly.

See [mobile.md](mobile.md) for the limits and why they are those.

## The retention schedule is readable, and applying it is a decision

`GET /retention/schedule` returns every policy with its period, what happens when
the period ends, the reason that period was chosen, and how many rows are past it
right now. The backlog is on the same response as the schedule because they
answer one question: the schedule says what should happen and the backlog says
whether it is happening, and for eleven phases this platform could answer only
the first.

Counts are bounded — past a ceiling the response says "at least", because a page
that counted nine million spent sessions to render a number is a page nobody
opens.

`POST /retention/runs` applies it. `dryRun` defaults to **true**: a form that
erases by omission is a form somebody will submit by accident, and this is the
one operation in the platform with nothing to undo it. Step-up authenticated for
the same reason. Each policy is bounded to a batch, and a response carrying
`moreRemaining` means exactly that — the next run continues.

`GET /retention/runs` is the ledger: per run, per policy, the cutoff and the
count. Never the contents, and never row identifiers.

Both actions are held by the Data Protection Officer and nobody else, including
no platform administrator. See [retention.md](retention.md).

## The citizen credential is a code, not a record

`GET /me/credential` returns a resident's credential and a `verificationUrl` for
the QR code they show at a counter. The URL carries an opaque token and nothing
else: not the Plateau Citizen ID, not a name, not a signed assertion that could
be read offline.

The token authorises nothing by itself. `POST /verification/credential` resolves
it only for an authenticated officer who holds the verification action, and
answers with whether the credential is live and the name printed on it. That is
the whole of the release. Expired, revoked and unrecognised codes are all
reported plainly, so an officer knows to ask for a fresh one rather than guessing.

The token expires in five minutes. A photograph of somebody's screen is therefore
worth nothing shortly afterwards, and a resident who reports a credential lost
invalidates every token issued against it at the same moment.

Both kinds of check — a scanned code and a typed identifier — appear in the
resident's own verification history, naming the office that made them.

## Every route names the entitlement it needs

Each operation carries `x-pcid-actions`: the authorisation actions it performs.
An integrator can therefore see which entitlement a call needs before making it,
rather than discovering it from a refusal.

It is also asserted. `services/api/test/unit/action-coverage.test.ts` compares
the actions the seeded roles grant against the actions the documented routes
perform, in both directions. An action a role grants with no route behind it is
an entitlement nobody can exercise — it reads, in the role definition and in
`GET /auth/me`, as a capability the account has, so an administrator assigns the
role believing the work can be done and the officer finds there is nothing to
click. Three of those survived four phases unnoticed, which is why this is a
test rather than a review step.

Actions seeded ahead of the surface that will perform them are listed explicitly
in that test with the surface named, and the test fails if the list grows or goes
stale.

## Versioning

The path carries the major version. Within `v1`, additive changes (new endpoints,
new optional parameters, new response fields) may ship at any time; a removal or a
narrowing is a new major version. Clients must ignore unknown response fields.
