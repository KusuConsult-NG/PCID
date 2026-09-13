# Architecture

## The problem this shape solves

A state identity registry fails in one of two ways. It fails _closed_ when the
controls are so heavy that an officer with a genuine need cannot get an answer in
time — and the workaround becomes a phone call, a spreadsheet, a photograph of a
screen. It fails _open_ when a login is all it takes to read anybody's record,
and the register becomes something residents are right to fear.

The architecture here is built around one idea that answers both: **the unit of
authorisation is not the user, it is the (user, purpose, record, field) tuple**,
and there is exactly one component that decides it.

## Components

```
                    ┌─────────────────────────────────────────┐
   Portals,         │            services/api                  │
   MDA systems ───► │                                          │
   Mobile apps      │  Guard ─► Controller ─► PolicyService ───┼──► @pcid/policy
                    │             │              │             │    (pure, no I/O)
                    │             │              ▼             │
                    │             │        AuditService ───────┼──► audit_event
                    │             ▼                            │    (hash chained)
                    │         Domain service ──────────────────┼──► PostgreSQL
                    └─────────────────────────────────────────┘
                                        ▲
                                        │ projections only, never write-back
                                 Integration adapters
                                        ▲
                                  Agency systems
```

### `packages/contracts` — the vocabulary

Classifications, lawful purposes, actions, seeded roles, resource types, and the
**field catalogue**. The catalogue is the heart of it: for every field the
platform can release, it records the classification, the closed set of purposes
it may be released for, whether release additionally needs an approval, whether
it forms part of the minimum-necessary emergency profile, and whether the citizen
sees it on their own record.

The default answer for a field not in the catalogue is "not released". Adding a
column to a table therefore does not make it reachable; it has to be catalogued
and mapped, deliberately, by someone who has thought about who should see it.

The PCID format lives here too, because it is a contract with everyone who prints
it, scans it or types it.

### `packages/policy` — the decision

A pure function from evidence to decision. No database, no clock beyond the one
passed in, no configuration read at call time. That is what makes it possible to
enumerate its behaviour in tests rather than hope about it.

Sixteen gates run in order, deny-overrides:

| #   | Gate                     | Question                                                        |
| --- | ------------------------ | --------------------------------------------------------------- |
| 1   | `ACCOUNT_STANDING`       | Is the account active?                                          |
| 2   | `AGENCY_STANDING`        | Is the agency active in the registry?                           |
| 3   | `DATA_SHARING_AGREEMENT` | Is an agreement in force for citizen data?                      |
| 4   | `AUTHENTICATION`         | Is MFA enrolled; is a machine caller strongly authenticated?    |
| 5   | `STEP_UP`                | Does this action need a freshly re-authenticated session?       |
| 6   | `RBAC`                   | Does a role grant this action?                                  |
| 7   | `RESOURCE_TYPE`          | Can this action even be applied to this kind of record?         |
| 8   | `ACCESS_WINDOW`          | Is the account inside its authorised hours?                     |
| 9   | `SEPARATION_OF_DUTY`     | Is the account administering itself?                            |
| 10  | `SELF_SERVICE_SCOPE`     | Is a citizen staying within their own record?                   |
| 11  | `PURPOSE`                | Is this a lawful purpose for this action?                       |
| 12  | `COMPARTMENT`            | Does the agency hold the compartment the record is marked with? |
| 13  | `CLASSIFICATION_RANK`    | Is the record within the clearance ceiling?                     |
| 14  | `JURISDICTION`           | Is the record inside the account's geography?                   |
| 15  | `CASE_BINDING`           | Is there an active case, and is this account on it?             |
| 16  | `INCIDENT_BINDING`       | Is there an active incident, and is this account on it?         |

Then field release runs, and every candidate field must independently clear its
purpose, the clearance ceiling, its compartment, any approval it demands, the
self-service flag for citizen callers, the minimum-necessary projection for
responder reads, and the thin projection for searches.

Gates 1–13 are absolute. Gates 14–16 are _binding_ gates, and an in-scope
break-glass grant can stand in for one — which is the whole of what break glass
is allowed to do.

**Why the order matters.** The compartment gate runs before the rank gate
because, for a record carrying a law-enforcement marking, "your agency is not
authorised for this compartment" is the true and more useful statement; reporting
a rank failure would send an administrator off to raise a clearance that would
not have helped.

### `services/api` — the enforcement

`PolicyService.authorize()` is the only way a route reaches a record. It gathers
the evidence the engine needs (the case, the incident, the break-glass grant, any
approvals), calls the engine, **writes the audit record before returning**, and
discharges the obligations the decision carries — notifying supervisors, opening
a review, counting a break-glass use.

Writing the audit record first is deliberate: a failure to record an access fails
the request. The platform would rather refuse a lookup than perform one it cannot
account for.

## Decisions worth explaining

### The token carries identity, not entitlements

An access token names the subject, the session and the assurance level, and
nothing else. Roles, clearance, agency standing and the data-sharing agreement
are read from the database on every request.

That costs a query per request. It buys immediate revocation: removing a role,
suspending an agency, or letting an agreement lapse takes effect on the next
call, rather than whenever a token happens to expire. For a platform where
"we revoked their access" has to be true the moment it is said, that is the right
trade.

### Search and view are different acts

A search returns a deliberately thin projection — enough to confirm you have the
right person, and nothing more. Opening the record is a separate, separately
authorised act. For investigative purposes it additionally requires associating
the person with the case first, which is itself an audited event carrying a
written justification.

The sequence is what makes "who looked at this person, and under what authority"
answerable after the fact. It also removes the pattern where an officer learns
what they want from a results list and never formally opens anything.

### Denials are sometimes opaque and sometimes not

Telling an officer _what is missing_ is what lets them put it right: no case
reference, a record not yet associated with their case, a closed incident, a step
that needs re-authentication. Those denials say so.

But a denial must never become an oracle. "You are not assigned to this case"
would confirm to anyone who guesses a case number that the case exists. So that
denial, and a lookup for a record the caller may not see, both return the same
answer as a record that does not exist — while the audit row keeps the precise
reason for oversight.

### The platform projects, it never owns

A property record belongs to the lands registry; a tax record to the revenue
service. The platform holds a _projection_ stamped with the source agency, the
source record id, when the source last changed it, and when the platform last
synchronised. Reads are served from the projection and say how stale it is.

Nothing writes back. There is no write endpoint for a linked record at all — a
correction becomes a request routed to the owning agency. That is also why an
agency outage degrades freshness rather than availability: emergency response
does not stop because a registry is down.

### Cases and incidents are the unit of investigative and emergency authority

Rather than a standing entitlement to "security data", an officer's reach is
bounded by the case or incident they are actually working. Closing it closes the
access, with no separate revocation step to forget. Break glass exists for the
case the model cannot anticipate, and is bounded to an hour, notifies supervisors
on first use, and opens a review obligation.

### Administration and data are separate entitlements

`PLATFORM_ADMINISTRATOR` grants administrative actions and no citizen-data action
at all. The engine reads only the resolved action list, so there is no branch
where being an administrator widens a data decision — and a separation-of-duty
gate stops any account administering its own entitlements.

## Data flow: an emergency identification

1. A dispatcher creates an incident. That record is what will authorise access.
2. A unit is dispatched; its agency joins the incident, opening incident-bound
   access for the crew attending.
3. At the scene the responder scans the credential and requests the emergency
   profile, naming the incident.
4. The engine checks the responder's role, the agency's standing and agreement,
   the incident's status and their attachment to it, then releases only the
   catalogued emergency fields — name, approximate age rather than date of birth,
   sex, photograph reference, LGA, emergency contacts, and, where the responder
   is cleared, blood group and disclosed critical conditions.
5. The access is audited with the incident, the fields released and the fields
   withheld.
6. Closing the incident closes the access.

If the responder is not attached to the incident, they may raise a break-glass
grant, which supervisors are notified of immediately and must review within 24
hours.

## Technology, and why

**PostgreSQL** for everything, including the audit chain. Constraints, triggers
and privileges let the most important guarantees hold _below_ the application, so
a bug in a service cannot violate them. `pg_trgm` provides name matching without a
separate search cluster at this scale; PostGIS is used for the command map where
available, and the schema works without it.

**Node.js and TypeScript** across the stack, with a strict compiler. The
authorisation model is expressed in types — actions, purposes, classifications
and field paths are all closed unions — so a whole class of mistake is a
compile error.

**NestJS** for the API. A global guard means a route is authenticated unless
explicitly marked public: forgetting the guard on a new controller fails closed.

**`pg` directly, no ORM.** Every statement is written and reviewable, which
matters for a schema where the difference between two queries is the difference
between releasing a field and not.

**Few dependencies in the security path.** TOTP, the access-token format and the
OpenAPI generation are implemented here rather than pulled in: they are small,
well-specified, and the platform's second factor should not be a transitive
supply-chain risk.

## Scaling

The API is stateless; sessions and counters live in PostgreSQL and Redis. Horizontal
scaling is adding instances behind the gateway. Redis is required in production so
rate limits are shared rather than per-instance.

The identity service is treated as mission-critical: an instance that cannot reach
the database fails its readiness probe and removes itself, rather than serving
errors.

Nothing about the design assumes a single machine, and the container carries no
local state, so a move to Kubernetes is a deployment change rather than a redesign.

## What is not built yet

The API is the whole surface today. Still to build:

- **Web portals** for citizens, government users, security agencies and emergency
  services. The API returns everything they need, including which cards are
  restricted and why, so the interface can say "Restricted information" honestly.
- **Mobile applications** for citizens, field officers and responders, including
  the controlled offline mode described in §56 — encrypted, expiring,
  device-bound, minimal, revocable, and never a copy of the registry.
- **The GIS command map**: the data and the PostGIS indexes are in place.
- **Notification delivery workers**: notifications are queued and their state is
  modelled; the SMS, email and push senders are not written.
- **Load testing** against statewide volumes, and an independent security
  assessment. Neither can be self-certified, and neither has been done.

Until those are complete the platform is not ready for a pilot, whatever the test
suite says.
