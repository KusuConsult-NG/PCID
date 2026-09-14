# MDA integration guide

For a ministry, department or agency connecting a system to the platform.

## What integration means here

The platform does **not** take over your records. It holds a _projection_ of them
so an authorised officer can find a record through a Plateau Citizen ID, and it
records every time anyone does.

Three consequences, and they are the whole agreement:

- **You remain authoritative.** Every projected record is stamped with your
  agency, your system, your record id and when you last changed it.
- **The platform never writes back.** There is no write endpoint for a projected
  record. A correction becomes a request routed to you.
- **You control what you share.** The field catalogue is agreed, not assumed.

## Before any data moves

1. **Register the agency** in the Government Agency Registry. A new agency is
   INACTIVE with no agreement and grants nothing until activated.
2. **Sign the data-sharing agreement.** Until its status is `SIGNED`, no officer
   of your agency can read citizen information — the policy engine refuses it.
   Set an expiry; access stops the moment it lapses, evaluated per request.
3. **Agree the fields.** For each field: its classification, the purposes it may
   be released for, and whether release needs supervisor approval. This becomes an
   entry in the field catalogue. A field not in the catalogue is never released.
4. **Agree the jurisdiction and maximum classification** your agency receives.
5. **Nominate a Data Protection Officer** and an administrator.

## Connecting a system

The platform reaches every external system through one adapter interface. You
implement a small read API; the platform polls it.

### What your API must provide

```http
GET /records/changed?since=2026-03-04T00:00:00.000Z&limit=500
GET /records?key=<natural key>&limit=50
GET /records?pcid=PL-XXXXX-XXXXX-XX&limit=50
GET /health
```

Authenticated with a bearer credential the platform holds in its secrets manager.
Responses are JSON:

```json
{ "records": [ { "sourceRecordId": "...", "sourceUpdatedAt": "...", ... } ] }
```

Every record must carry `sourceRecordId` (stable and unique in your system) and
`sourceUpdatedAt` (or null).

### Agreed record shapes

Defined in [`schemas.ts`](../services/api/src/integration/schemas.ts). A response
that does not match is treated as an **outage**, not as data: a misconfigured or
compromised upstream must not be able to write unexpected fields into a citizen's
record.

Supported domains today: vehicles and transport, property and lands, business,
revenue, and licences (education and social services). Adding a domain means
adding a schema, catalogue entries and a projection writer — a small, reviewable
change.

### Registering the source

```http
POST /api/v1/integrations
{
  "agencyId": "...",
  "domain": "LANDS",
  "systemName": "Lands Registry Core",
  "adapterKey": "lands-production",
  "mode": "PRODUCTION",
  "baseUrl": "https://lands.internal.plateaustate.gov.ng/api/",
  "config": {
    "credentialEnvVar": "LANDS_API_CREDENTIAL",
    "lookupPath": "/records",
    "changedSincePath": "/records/changed",
    "healthPath": "/health",
    "recordsPointer": "records",
    "timeoutMs": 5000,
    "maxRetries": 2
  }
}
```

The credential is named, never carried in the request or stored in the database.

### Synchronising

```http
POST /api/v1/integrations/{dataSourceId}/sync
```

Incremental from the last successful run. The result reports records examined,
written and conflicted.

A PCID your record cites that the registry does not hold raises a **data
conflict** for review rather than creating a link. That is the case where two
agencies disagree about who someone is, and it needs a person.

If your system is unreachable the sync reports `FAILED` and the platform keeps
serving the last good projection, marked with its age. Your outage slows
freshness; it does not take emergency response offline.

## Developing against the platform

Use a sandbox data source (`"mode": "SANDBOX"`) backed by fixtures. Sandbox
adapters refuse to construct in a production process, so fixture data can never
reach live traffic.

## Using the platform as an officer

```http
POST /api/v1/auth/login          → then the second factor
GET  /api/v1/citizens?purpose=SERVICE_DELIVERY&name=...
GET  /api/v1/citizens/{pcid}?purpose=SERVICE_DELIVERY
POST /api/v1/verification/pcid   { "pcid": "PL-..." }
```

Points that surprise people, in the order they usually do:

- **`purpose` is required and checked.** Not logged — checked.
- **Not everything comes back.** `restrictedFields` names what was withheld;
  show "Restricted information" rather than omitting it.
- **404 is ambiguous on purpose.** It means "does not exist, or is not available
  to you". Do not tell your users which.
- **Every access is audited**, and the resident can see it.
- **Searching is rate limited** and sustained volume raises an alert.

`GET /api/v1/auth/me` returns the officer's resolved action list — use it to
disable what the account genuinely cannot do rather than guessing from role names.

## Bulk import

For a one-off migration of historic records:

1. Upload the file (CSV or Excel).
2. The platform validates, reports errors, and previews.
3. Duplicate detection runs; candidates queue for review.
4. An authorised officer approves.
5. Import runs and reconciles.
6. The whole job is audited.

The `import_job` model is in place; the file-handling endpoints are on the
roadmap, so a migration today is a scripted API load using the same duplicate
review path.

## Support

Quote the `x-correlation-id` from the response. It ties your client log, the
platform's operator log and the audit record together without anyone needing to
exchange personal data.

## Which entitlement a call needs

Every operation in the published contract carries `x-pcid-actions`: the
authorisation actions it performs. Read it before building against an endpoint —
it tells you which role your agency's accounts need, rather than leaving you to
discover it from a refusal in testing.
