# Plateau Citizen Identity & Data Exchange Platform (PCID)

A state identity and public-safety interoperability platform for the Government
of Plateau State.

The platform issues a **Plateau Citizen ID (PCID)** and uses it to link records
that other government agencies own, so that an authorised officer can identify a
person and reach the information their role and purpose actually entitle them
to — and so that every such access is accounted for afterwards.

The PCID is the state's own identity reference. It does not depend on the
national identity number: a NIN may be recorded where an authoritative source
supplied one, and is never required to obtain a PCID.

## What this repository contains today

| Area                                                          | State                                      |
| ------------------------------------------------------------- | ------------------------------------------ |
| Authorisation model, field catalogue, PCID format             | Complete and exhaustively tested           |
| Citizen registry, registration, duplicate review, corrections | Complete                                   |
| Government Agency Registry, users, roles, MFA, sessions       | Complete                                   |
| Immutable hash-chained audit and citizen access transparency  | Complete                                   |
| Incidents, dispatch, response units, emergency identification | Complete                                   |
| Cases, case-bound access, access requests, break glass        | Complete                                   |
| Missing persons, unidentified persons, candidate matching     | Complete                                   |
| Integration framework and linked-record projections           | Complete (sandbox and production adapters) |
| Public-safety analytics with small-number suppression         | Complete                                   |
| Notification delivery: templates, worker, retry, operations   | Complete                                   |
| GIS command map: bounded spatial queries, the command picture | Complete                                   |
| Citizen portal (`apps/portal`)                                | Complete                                   |
| Government portal (`apps/government`)                         | Complete                                   |
| Security agency portal (`apps/security`)                      | Complete                                   |
| Emergency response portal (`apps/emergency`)                  | Complete                                   |
| Oversight: duplicate, correction and alert queues             | Complete                                   |
| Mobile applications                                           | Not started — see [Roadmap](#roadmap)      |

Five things run: the REST API, documented in OpenAPI at `/api/v1/docs` (and
written to `docs/openapi.json` by `npm run openapi`), and four portals — for
residents, for government counters, for security agencies, and for emergency
control rooms and crews. Every portal is a client of that API like any other:
none holds a database credential or a signing key, and each is authorised
exactly as the person signed into it is.

## The idea in one paragraph

Identity alone is not the point. A state registry is only trustworthy if
_reaching_ a record is harder than holding a login. So every request carries a
declared lawful **purpose**; a single [policy engine](packages/policy) decides,
field by field, what may be released for that purpose to that role in that
agency; and the decision — permitted or refused, with the fields released and
the fields withheld and why — is written to a tamper-evident audit record before
the answer is returned.

## Repository layout

```
packages/contracts    Shared vocabulary: classifications, purposes, actions,
                      roles, the field catalogue, and the PCID format.
packages/policy       The authorisation engine. Pure, I/O-free, deny-by-default.
services/api          The API service: NestJS over PostgreSQL.
packages/portal-kit   What the portals share: the sealed session, the API
                      client, the form controls and the design system.
apps/portal           The citizen portal: Next.js, server-rendered, holding the
                      resident's session so no API token reaches the browser.
apps/government       The government portal: search under a stated purpose, the
                      registration desk, and the oversight queues.
apps/security         The security agency portal: case files, case-bound access
                      to the register, missing and unidentified persons.
apps/emergency        The emergency response portal: the board, dispatch, and
                      the minimum necessary profile under a live incident.
db/migrations         Version-controlled schema migrations.
docs/                 Architecture, security, privacy, operations and guides.
```

## Getting started

Requirements: Node.js 22, PostgreSQL 16, and (for the disaster-recovery test)
the PostgreSQL client tools.

```bash
npm install

# Two distinct 32-byte keys.
export TOKEN_SIGNING_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export SECRET_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/pcid

createdb pcid
npm run db:migrate
npm run db:seed

# Create the first administrator. It holds administrative actions and no
# entitlement to citizen data whatsoever.
BOOTSTRAP_ADMIN_EMAIL=you@example.gov.ng \
BOOTSTRAP_ADMIN_PASSWORD='choose-a-long-passphrase-here' \
npm run db:bootstrap --workspace services/api

npm run dev:api        # http://localhost:3000/api/v1/docs
```

### A populated environment in one command

With the API running, `npm run db:demo` creates the agencies, officers and one
resident that make the platform legible, and prints every credential it issued.
It writes through the same registration, duplicate-detection and audit paths as
anything else, and refuses to run against a production configuration.

```bash
npm run db:demo
```

### The portals

```bash
export PCID_API_URL=http://127.0.0.1:3000
# One key per portal, each distinct from the API's two.
export PORTAL_SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export GOVERNMENT_PORTAL_SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export SECURITY_PORTAL_SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export EMERGENCY_PORTAL_SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")

npm run dev:portal       # http://localhost:3100 — residents
npm run dev:government   # http://localhost:3200 — counter officers
npm run dev:security     # http://localhost:3300 — security agencies
npm run dev:emergency    # http://localhost:3400 — control rooms and crews
```

Sign in with the credentials `npm run db:demo` printed: the resident with their
Plateau Citizen ID, an officer with their work email address and the six-digit
code from the authenticator secret beside it. Both will ask for a passphrase of
your own before showing you anything, because the one you were given was chosen
by somebody else.

Or bring the whole stack up with Docker:

```bash
export TOKEN_SIGNING_KEY=... SECRET_ENCRYPTION_KEY=... \
       PORTAL_SESSION_KEY=... GOVERNMENT_PORTAL_SESSION_KEY=... \
       SECURITY_PORTAL_SESSION_KEY=... EMERGENCY_PORTAL_SESSION_KEY=...
docker compose up --build
```

## Verifying the build

```bash
npm run verify              # format, lint, typecheck, unit and integration tests
npm run test:e2e            # all four portals, in a browser, end to end
```

`npm run test:integration` compiles with `tsc` and runs against the compiled
output. That is deliberate: esbuild-based loaders do not emit decorator
metadata, so the tests would otherwise exercise a differently-wired application
than the one that ships.

The integration suite creates and drops its own databases; point
`TEST_ADMIN_DATABASE_URL` at a PostgreSQL superuser connection.

`npm run test:e2e` runs all four portal suites. Each starts an API and a portal
of its own, against a database it recreates for the run, seeds them with `npm run
db:demo`, and drives a real browser through the journeys — including an
accessibility audit of every page against WCAG 2.1 AA. They need a Chromium
build: `npx playwright install chromium`.

## The controls, and where to read them

| Control                                   | Where it lives                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Sixteen ordered authorisation gates       | [`packages/policy/src/gates.ts`](packages/policy/src/gates.ts)                                               |
| Field-by-field release                    | [`packages/policy/src/field-release.ts`](packages/policy/src/field-release.ts)                               |
| What each field is, and who may see it    | [`packages/contracts/src/field-catalogue.ts`](packages/contracts/src/field-catalogue.ts)                     |
| Enforcement, audit and obligations        | [`services/api/src/policy/policy.service.ts`](services/api/src/policy/policy.service.ts)                     |
| Append-only, hash-chained audit           | [`db/migrations/0003_audit.sql`](db/migrations/0003_audit.sql)                                               |
| Permanent PCID allocation                 | [`db/migrations/0004_citizen_registry.sql`](db/migrations/0004_citizen_registry.sql)                         |
| The seven §75 propositions                | [`packages/policy/test/critical-authorization.test.ts`](packages/policy/test/critical-authorization.test.ts) |
| The same, over HTTP                       | [`services/api/test/integration/authorization.test.ts`](services/api/test/integration/authorization.test.ts) |
| The end-to-end acceptance scenario        | [`services/api/test/integration/acceptance.test.ts`](services/api/test/integration/acceptance.test.ts)       |
| The portal's own security properties      | [`apps/portal/e2e/security.spec.ts`](apps/portal/e2e/security.spec.ts)                                       |
| What an officer's account cannot do       | [`apps/government/e2e/entitlements.spec.ts`](apps/government/e2e/entitlements.spec.ts)                       |
| A record is reachable only under a case   | [`apps/security/e2e/investigation.spec.ts`](apps/security/e2e/investigation.spec.ts)                         |
| One agency, three officers, three portals | [`apps/security/e2e/supervision.spec.ts`](apps/security/e2e/supervision.spec.ts)                             |
| WCAG 2.1 AA on every portal page          | [`apps/portal/e2e/accessibility.spec.ts`](apps/portal/e2e/accessibility.spec.ts)                             |
| Every granted action has a route          | [`services/api/test/unit/action-coverage.test.ts`](services/api/test/unit/action-coverage.test.ts)           |

## What the platform deliberately cannot do

These are absences by design, and each is held by a test:

- **No citizen location tracking.** The only live positions held are those of
  response units, reported by the units themselves. Every stored coordinate
  records how it was obtained; there is no code path that observes a person. The
  command map has no layer that could show one, and no function in it takes a
  person.
- **No map tile leaves the browser.** The command map draws from the platform's
  own data and fetches nothing from anywhere: a tile provider receiving the
  rectangle a control room is looking at, several times a minute, would be
  receiving a description of where the state's emergencies are.
- **No bulk export.** No role in the platform grants an export action.
- **No personal information in an outbound message.** An SMS or an email from
  the platform carries a notice — "there is something waiting for you" — and
  never the thing it is about. The detail is read in the portal, behind
  authentication, by the person it concerns.
- **No citizen risk scoring.** Nothing scores, ranks or classifies a person, and
  no query groups by any protected or sensitive characteristic.
- **No automated identification.** The matching engine produces candidates with
  their reasoning attached. A database constraint refuses a confirmed match that
  has no named human reviewer.
- **No biometrics.** An unidentified-person record can reference material held
  by an agency with lawful authority for it. The platform stores none and
  matches none.
- **No administrator backdoor.** Technical administration and citizen data are
  separate entitlements, and an account cannot administer its own.

## Documentation

- [Architecture](docs/architecture.md) — how the pieces fit and why
- [Security](docs/security.md) — the controls, and the threats they answer
- [Privacy](docs/privacy.md) — data protection by design
- [Database](docs/database.md) — the schema and its invariants
- [API](docs/api.md) — conventions every endpoint follows
- [Deployment](docs/deployment.md) — running it in production
- [Disaster recovery](docs/disaster-recovery.md) — RPO, RTO and the restore drill
- [Incident response](docs/incident-response.md) — when something goes wrong
- [MDA integration guide](docs/mda-integration.md) — connecting an agency system
- [Administrator guide](docs/administrator-guide.md)
- [Security agency guide](docs/security-agency-guide.md)
- [Emergency response guide](docs/emergency-response-guide.md)
- [Citizen guide](docs/citizen-guide.md) — and the portal a resident uses
- [Developer guide](docs/developer-guide.md)
- [Architecture decision records](docs/adr/)

## Roadmap

Delivered: platform foundation, authentication and authorisation, MDA
administration, the PCID and citizen registry, the citizen portal, the
government portal and its oversight queues, the security agency portal, the
emergency response portal and its command map, the data exchange and integration
framework, asset registry integration, emergency response, security and case
management, missing and unidentified persons, analytics, and notification
delivery.

Remaining before a pilot: the citizen, field officer and responder mobile
applications; load testing; and an independent security assessment.
[docs/architecture.md](docs/architecture.md#what-is-not-built-yet) sets out what
each needs.

## Licence

Property of the Government of Plateau State. Not licensed for redistribution.
