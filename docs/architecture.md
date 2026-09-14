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
  Resident's browser  ──►  apps/portal      ─┐
                           (their own record) │
                                              │
  Counter officer     ──►  apps/government   ─┤   ┌────────────────────────────────────────┐
                           (anybody's, under  │   │            services/api                │
                            a stated purpose) │   │                                        │
                                              ├──►│  Guard ─► Controller ─► PolicyService ─┼─► @pcid/policy
  Investigator        ──►  apps/security     ─┤   │            │              │            │   (pure, no I/O)
                           (only under a case │   │            │              ▼            │
                            they are on)      │   │            │        AuditService ──────┼─► audit_event
                                              │   │            │                           │   (hash chained)
  Control and crews   ──►  apps/emergency    ─┤   │            ▼                           │
                           (only under a live │   │        Domain service ─────────────────┼─► PostgreSQL
                            incident)         │   └────────────────────────────────────────┘
                                              │                       ▲
  MDA systems  ───────────────────────────────┤                       │ projections only,
  Mobile apps  ───────────────────────────────┘                Integration adapters   never write-back
                                                                      ▲
                                                                Agency systems
```

All four portals are server-rendered and hold their own session; none puts a
token in a browser. They share `packages/portal-kit` for exactly that reason -
four copies of a session-sealing routine is three copies that quietly stop being
reviewed. Each seals its cookie with its own key and sets its own idle timeout,
so a compromise of one produces nothing usable against another.

What they do not share is vocabulary. The same audit row is described four ways,
because "your record was opened", "the record was released to you at the
counter", "opened under CASE-2026-00928" and "read at the scene of
INC-2026-000123" are the same event told to four audiences, and one wording
would be wrong for three of them.

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

### `apps/portal` — what a resident sees

A Next.js application rendered entirely on the server. It is a client of the API
like any MDA system: it holds no database credential, no signing key and no
entitlement of its own. What it holds is the session of the person currently
signed in — the access and refresh tokens, sealed with AES-256-GCM into an
http-only, same-site cookie that the browser cannot read and cannot replay
anywhere else.

That shape is the point. If the browser held a token, every cross-site scripting
bug in a state identity portal would be a token theft. Here there is nothing in
the page to steal: the tokens never leave the server, and an end-to-end test
asserts it on every page.

The portal renders what the API released and says so where it did not. A card the
policy engine withheld is shown as "Restricted information" rather than omitted,
because an absent card and an absent record must not look the same (§29).

Everything works without JavaScript. Forms are Server Actions, navigation is
links, and the single client component is a submit button that dims while a form
is in flight. A resident on a cheap phone on a bad connection is the normal case,
not the edge case.

### `apps/government` — what an officer sees

The same back-end-for-front-end shape as the citizen portal, for a stronger
reason: the token this application holds opens other people's records.

Three things about it are worth stating because they are design positions, not
implementation details.

**The navigation is built from the account's resolved entitlements**, read from
`/auth/me` — which is the list the policy engine itself reads. A registration
desk is not shown an audit trail; an auditor is not shown a registration form.
That is not tidiness: a menu of twenty items of which three work teaches people
to click and see, which is precisely the habit a purpose-bound system cannot
afford. It remains a rendering decision and never an authorisation one — every
request is authorised again at the API, so a stale entitlement list shows a link
that does not work rather than opening something it should not.

**The purpose is part of the act, not a setting.** A record cannot be opened
without one; the chosen purpose stays on screen for as long as the record is,
because it is what decided the contents of the page and what was written down
against the officer's name.

**A withheld card is shown as withheld.** An officer who cannot tell the
difference between "no property is registered to this person" and "you may not
see their property" will draw the wrong conclusion from a blank page (§29).

### `apps/security` — what an investigator sees

The third portal reaches the same register as the second, under a materially
different authority, and the interface is shaped by that difference rather than
decorated to hide it.

**A record opens only under a case.** There is no route from a search result
into a record. A search returns a thin projection whose sole action is _Link to
CASE-…_, and linking is a separate act that demands a written justification and
is audited in its own right. That sequence exists to remove the pattern where an
officer learns what they wanted from a results list and never formally opens
anything. Reaching `/person/:pcid` without a case does not fail obscurely: the
page says that the policy engine refuses an investigative read that names no
case, and offers the case list.

**The working case is a convenience and never an authority.** The session
carries the case an officer is working under so they do not retype it. It is
sent as the case reference on each request and the engine decides afresh every
time — the case has to be active, this officer has to be assigned to it, and the
person has to be linked to it. The banner says so on every page it appears on.

**Assignment is reachable from outside the case.** Reading a case file is
case-bound; assigning an officer to a case deliberately is not, because
otherwise a case becomes unjoinable the moment the officer holding it leaves.
The assignment form therefore also lives on the case list, where it needs
nothing but a case number — the engine still requires the case to belong to the
account's agency, to be active, and to sit within its clearance.

**A closed case authorises nothing, including its own file.** Closing is
irreversible through this interface and the file is no longer readable by
anybody, so the portal sends the closing officer back to the list with an
explanation rather than to a refusal for the thing they just did. For the same
reason the status form offers no way to set SUSPENDED: a suspended case
authorises no access, and changing a case is itself case-bound, so it would be a
door with no handle on the far side.

**Break glass is shown as absent, not omitted.** No investigative role holds
`BREAK_GLASS_INITIATE` — it belongs to emergency-response roles — so the page
says that plainly. An officer who finds nothing concludes the platform cannot do
it, and then does something worse.

### `apps/emergency` — what a control room and a crew see

The fourth portal is read in two very different places, and the design answers
both: a board on a control-room wall, eight feet away, and a tablet in a moving
ambulance at three in the morning.

**The board says the severity in words as well as in colour**, sorts what is
most urgent to the top without anybody clicking a column, and puts a call that
has had nothing sent to it above one of the same severity that has. Some of the
people reading a screen across a room cannot tell red from amber, and none of
them should have to sort a list during a fire.

**The identify screen asks two things.** Which incident, and the identifier on
the credential — filled in from the incident the crew said they were attending.
It states, above the button, exactly what will come back and exactly what will
not, because a responder who expects an address and receives none will think the
system is broken rather than that it is working.

**The profile is ordered clinically, not alphabetically.** What keeps somebody
alive is at the top, who to telephone is next, and the identifying details are
last. A screen that made a responder scroll past a postcode to find a blood
group would be a worse screen even if it released exactly the same fields.

**The session lasts twelve hours, the longest of the four.** That is the
opposite of what a risk table alone would say and it is deliberate: a crew
locked out mid-job writes the passphrase on the dashboard, and then the control
is worse than none. What holds the risk down here is the reach — the minimum
necessary set, under a live incident the account is attached to — and not the
timeout.

**A finished incident is still a record.** Closing ends the access it granted to
the people on it, and the incident itself stays readable to those who were on
it. That is where an incident differs from a case: a case file lists its subjects
by identifier with the reason each was linked, so closing a case closes the file;
an incident record names no citizen at all, and a service that cannot read back
a job it attended cannot debrief it or answer a complaint about it.

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

The API and the four portals are the surface today. Still to build:

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
