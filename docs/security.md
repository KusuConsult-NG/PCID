# Security

This document states the controls the platform implements, the threats each one
answers, and — as plainly as possible — what is not yet covered.

## Threat model

The platform holds the state's citizen registry and links it to records held by
police, emergency, revenue, lands and transport agencies. The adversaries that
shape the design, in the order they matter:

1. **The curious or corrupt insider.** An officer with a legitimate login who
   looks up a neighbour, a politician, or someone they are in dispute with. This
   is the most likely misuse of any government registry, and the one that
   destroys public trust fastest.
2. **The compromised account.** Credentials phished or reused from elsewhere.
3. **An attacker with network access** attempting authentication bypass,
   injection, or mass extraction through the API.
4. **The over-broad request.** An agency asking for more than its lawful basis
   supports, and a platform that cannot tell the difference.
5. **Alteration of history** to conceal any of the above.

Insider misuse is first because it is the one a login-plus-role system cannot
address at all. Most of what follows exists because of it.

## Authentication

- **Passwords** are stored with scrypt (N=32768, r=8, p=1, 32-byte key, per-record
  16-byte salt). Parameters travel with the hash so they can be raised and
  re-applied per user on next login. Verification is constant-time and always
  performs the full derivation, including for accounts that do not exist, so
  timing does not reveal who works for the government.
- **Password policy** requires 14 characters or more, mixed case and a digit, and
  rejects passphrases containing parts of the account's own name or email
  address. Composition rules stop there: length is what matters, and more rules
  push people toward predictable substitutions.
- **Multi-factor authentication is mandatory for government users.** The policy
  engine refuses a government user who is not MFA-enrolled, so an account whose
  authenticator has not been confirmed cannot reach citizen data however it
  authenticated.
- **TOTP** follows RFC 6238 (SHA-1, 30-second step, 6 digits, ±1 step of drift).
  The matched time step is recorded and a step at or below the last used one is
  refused, so a code observed over someone's shoulder cannot be replayed.
  Recovery codes are single use and stored encrypted.
- **Step-up (AAL2)** is required for approvals, administration, integration
  changes, imports and break glass. It expires on a short timer and is re-derived
  on every request, so a session that stepped up an hour ago is back to AAL1 now.
- **Brute force** is answered on three axes: per-identifier and per-IP rate
  limits that fail closed, an account lock after repeated failures, and a uniform
  response for every failed attempt — wrong password, unknown account and locked
  account are indistinguishable to the caller.

### The general ceiling was documented before it existed

`RATE_LIMIT_DEFAULT_MAX` was read from the configuration and described here and in
`docs/api.md` as "a general per-account ceiling". Nothing consumed it. Building
the offline mode is what surfaced it: the new routes hand out a pack of emergency
profiles, and the only per-account bound on how often an account could ask for one
would have been the ceiling that was not there.

It is now applied in the authentication guard, which every authenticated request
passes through, so it cannot be forgotten on a new controller. It is worth
recording as a finding rather than a fix: a control that exists only in a document
is worse than an absent one, because it is counted as present when somebody asks
what bounds an account.

### The retention schedule was written down and never applied

The same shape again, one phase later, and worth recording as a pattern rather
than as two incidents. `docs/privacy.md` printed a table of retention periods.
`citizen.retention_policy` carried a default, and every incident was stamped with
a `location_retention_until` date on creation. Nothing read any of it and no row
was ever erased.

Both of these — the general rate ceiling and this — were found by building
something next to them rather than by reviewing them, which says something about
where to look for the rest. The test that now holds it is the same shape as the
one that catches an entitlement with no route behind it: the catalogue and the
rules are compared in both directions, so a period added with nothing applying it
fails the build. [retention.md](retention.md) has the whole of it.

### Sign-in limits count failures, not sign-ins

Sign-ins were once rate limited by network address as well as by account: fifty
attempts per address per fifteen minutes. Load testing found what that means in a
building. A ministry's staff share one public address behind their gateway, so
the fifty-first person to arrive for the morning shift would have been refused —
not because anything was wrong with their account, but because fifty colleagues
had already signed in correctly. The symptom, "the system says too many sign-in
attempts", would have been blamed on the account rather than the gateway.

The address budget now counts **failed** sign-ins. That keeps what the control was
for: credential stuffing from one source is a stream of failures and still trips
it, while a shift change is a stream of successes and does not. Brute force
against one account is bounded separately, by a per-account budget that no shared
address affects, and by the account lockout behind it.

## Sessions and tokens

- Access tokens are a minimal JWS with **one algorithm and no negotiation**: the
  header must be exactly `{"alg":"HS256","typ":"JWT"}`. Algorithm confusion is
  removed by construction rather than by configuration.
- Tokens carry identity and assurance level only. Entitlements are read from the
  database on every request, so revocation is immediate.
- Refresh tokens are stored only as a SHA-256 hash and **rotate on every use**.
  Presenting a rotated token revokes the entire session family — the standard
  detection for a stolen refresh token.
- Sessions are checked for existence and revocation on every request; signing out
  takes effect at once.

## Authorisation

The [policy engine](../packages/policy) is described in
[architecture.md](architecture.md). The security-relevant properties:

- **Deny by default.** An action with no declared purpose set, or a field with no
  catalogue entry, is unusable. The safe failure direction.
- **Sixteen ordered gates**, of which thirteen are absolute.
- **Field-level release.** Authorisation to open a record is not authorisation to
  see all of it.
- **Purpose limitation is enforced, not recorded.** A field catalogued for
  emergency care is not released for revenue work, whatever the caller's
  clearance.
- **Compartments are separate from clearance.** A HIGHLY_RESTRICTED clearance does
  not confer law-enforcement material; the agency must hold the compartment,
  granted explicitly with a stated legal basis to an eligible agency category.
- **Break glass is bounded**: at most one hour (a database check constraint, not
  just application logic), scoped to one person and one record type, notifies
  supervisors on first use, opens a 24-hour review obligation, and can never
  substitute for a role, a clearance ceiling or a compartment.
- **Separation of duty**: no account administers its own entitlements, approves
  its own access request, reviews its own break-glass use, or confirms a match it
  ran.

## Against insider misuse specifically

- Every access declares a purpose, and it is checked rather than merely logged.
- Investigative access is bound to a case the officer is assigned to, and to a
  person deliberately associated with that case under a written justification.
- Emergency access is bound to an active incident the officer or their agency is
  attached to, and closes when the incident does.
- Searching returns a thin projection and is rate limited per account; unusual
  volume raises a security alert describing the _account's activity_, never the
  people searched for.
- There is no bulk export action in the platform at all.
- The citizen can see who looked at their record and why.

## Data protection

- **In transit**: TLS terminates at the gateway; the database connection requires
  TLS in production (`DATABASE_SSL` may not be `disable`, enforced at boot).
- **At rest**: managed volume encryption for the database and backups.
- **Application-level encryption** for secrets the platform must read back —
  today, TOTP seeds — using AES-256-GCM with a per-record IV and a version stamp
  for key rotation. The key comes from the deployment's secrets manager.
- **Classification** is carried on every record and every field, and drives
  release.

## Database

The application connects as `pcid_app`, which **owns no object**. It cannot alter
the schema, drop a trigger, or delete an audit row or PCID allocation. Migrations
run under a separate credential used only by the migration job.

No portal, MDA system, security application or analyst ever receives a database
credential. All access is through the API.

## Audit integrity

- Every access — permitted or refused — produces a row recording the actor, their
  agency and roles, the purpose, the record, the case or incident relied upon, the
  fields released, the fields withheld and why, whether break glass was used, the
  IP, the device and a correlation id.
- The table is **append-only at two independent levels**: triggers that refuse
  UPDATE, DELETE and TRUNCATE, and privileges that do not grant them.
- Each row is **hash-chained** to its predecessor, computed by the database on
  insert so a caller cannot choose its own. `verify_audit_chain()` walks the chain
  and names the first row that disagrees.
- The chain survives backup and restore, and the test suite proves both that an
  intact chain verifies and that a row altered with the triggers disabled is
  detected.

## API hardening

- Schema validation on every body, query and parameter; unknown keys are stripped
  rather than passed through, so a client cannot smuggle a field into a write
  path that a later refactor starts honouring.
- Page sizes and offsets are bounded.
- Rate limits: a general ceiling, a tighter ceiling on searches that fails
  closed, and a separate limit on second-factor attempts.
- Security headers via Helmet, including a restrictive CSP and `frame-ancestors
'none'`; `X-Powered-By` removed; CORS closed by default and allow-listed at the
  gateway.
- Request bodies capped at 256 KB.
- Errors never carry a stack trace or database text; every response carries a
  correlation id that ties the client report, the operator log and the audit row
  together without using personal data.

## The audit chain under concurrency

The chain trigger originally read its predecessor with an unlocked
`SELECT ... ORDER BY seq DESC LIMIT 1`. Two transactions inserting at the same
time both read the same tail, both wrote the same `prev_hash`, and the chain
forked — so `verify_audit_chain()` reported tampering that had not happened.
Measured on sixteen simultaneous inserts, fifteen landed on a broken chain.

This was found by the government portal's end-to-end suite, on a page that
issues five authorised calls in parallel. It matters more than a false alarm:
tamper evidence that fires during ordinary traffic teaches the reviewer to
dismiss the alarm, which is the failure mode the chain exists to prevent.

[Migration 0011](../db/migrations/0011_audit_chain_serialisation.sql) fixes both
halves of it. The chain head is one locked row, read with `SELECT ... FOR
UPDATE` — which re-reads the latest committed version after waiting, where a
plain `SELECT` stays inside the inserting statement's snapshot and an advisory
lock does not help. And the sequence number now comes from that same row rather
than from a `bigserial`, because sequence values are handed out before commit,
so the order the chain was forged in and the order it is verified in would
otherwise disagree. The trigger is `SECURITY DEFINER` and the application role
holds no privilege on the head table at all, so no application path can choose
its own predecessor. `security.test.ts` fires twenty-four concurrent authorised
reads and asserts the chain is still intact.

## The gate that stopped at the data

The incident-binding gate applied only to citizen-data actions. Reading,
changing and closing one named incident were therefore bound by nothing but
role, purpose and jurisdiction — so any account holding `INCIDENT_UPDATE` could
attach itself to any live incident in the state, and attaching is exactly the act
that opens the casualties' emergency profiles. Closing somebody else's incident
was open in the same way.

This was found while building the route the emergency guide has always called
"the normal path": control attaching a responder who is not on the incident.
Writing the route made the hole visible, because the route was the shortest way
to walk through it.

`INCIDENT_RECORD_ACTIONS` now mirrors `CASE_RECORD_ACTIONS`: `INCIDENT_VIEW`,
`INCIDENT_UPDATE` and `INCIDENT_CLOSE` are bound to the incident whenever one is
addressed, by account or by agency. A listing addresses none and is unaffected.

Two exceptions are deliberate and each has a test:

- **`DISPATCH_CREATE` is not bound.** Sending your own unit is how an agency
  joins an incident it did not open; binding it would mean the ambulance service
  could never answer a police-led incident. It attaches only the agency whose
  unit was actually sent.
- **A finished incident still admits closing and reading.** An incident is
  resolved before it is closed and resolved is not an active status, so a rule
  without the first exception would leave every incident stuck one step short of
  closed. The second is where an incident differs from a case: an incident record
  names no citizen, and a service that cannot read back a job it attended cannot
  debrief it or answer a complaint. The emergency profiles the incident
  authorised are a separate read and stay refused — that is the access closing
  was meant to end.

## A side channel that is not in the audit trail

The command map has no basemap, and that is a security decision rather than an
aesthetic one.

A conventional web map fetches a few hundred images a minute from a third party,
each named after a rectangle of the world. Over a shift in a control room that
is a continuous description of which parts of Plateau State somebody is
watching, correlatable with the times of day when something is happening,
delivered to a company under no obligation to anybody here — and it never
touches the platform, so it appears in no audit record and no oversight review
would ever find it.

The portal's content-security policy forbids every external origin, so the
browser could not fetch a tile if the page asked for one. The map is drawn on
the server as inline SVG from data the platform already holds, and
`apps/emergency/e2e/map.spec.ts` asserts that the page makes no request off the
host at all.

The same reasoning is why there is no analytics script, no font CDN and no error
reporter in any of the four portals. A request to somewhere else is a disclosure
that the audit trail cannot see.

## What leaves the platform

A notification is the one thing the platform sends to somebody rather than
waiting to be asked for. That makes it the one place where a control can be
undone by convenience: it is very easy to write a helpful SMS that tells whoever
is holding the handset which agency is looking at its owner.

So the channel decides what the message may carry, and a catalogue of constants
decides the channel. `IN_APP` and `DASHBOARD` stay inside the platform behind
authentication and carry the detail; `SMS`, `EMAIL` and `PUSH` carry the
template's notice and nothing else — no name, no reference, no description of
what happened.

- **One producer.** `NotificationsService.enqueue` is the only path that creates
  a notification. Before it, every service wrote its own `INSERT` and chose its
  own channel and body.
- **The sender sees an address and a string.** It is handed no PCID, no record
  and no template context, so there is no path by which a gateway integration
  can start sending more than the body it was given.
- **No passphrase on any channel.** A passphrase is handed over in person; the
  notice for a new account says so rather than being silent about it.
- **Suppression is recorded.** A resident with no telephone number is not an
  error, and the row says `SUPPRESSED` with a reason rather than disappearing.
- **The operations view discloses nothing.** Counts, causes and template keys.
  No body, no subject, no recipient — the screen is reachable by a technical role
  that holds no entitlement to citizen data at all (§7), and a delivery queue
  showing message bodies would be a second copy of every inbox.
- **A sandbox sender cannot run in production.** With no gateway configured and
  `ALLOW_SANDBOX_ADAPTERS` false, the worker reports no sender rather than
  logging every message and claiming a hundred per cent delivery.

`services/api/test/unit/notifications.test.ts` holds the catalogue to the rule:
a notice that interpolates anything fails, so does one carrying a reference or a
field path, and so does one too long for a single message.

## The portals

Each portal is a separate trust boundary and is treated as one. All four are
clients of the API with no database credential, no token-signing key and no
entitlement of their own; each is authorised exactly as the person signed into
it is, through the same policy engine as any other caller. They seal their
sessions with different keys, so a compromise of one does not produce a usable
cookie for another.

Their idle timeouts differ, and the differences are deliberate: thirty minutes
for a resident on their own phone, fifteen for an officer at a shared counter,
ten for the security agency portal, whose reach is case-bound access to the
register on a machine in a command room somebody else can walk into — and twelve
hours for the emergency portal, which is the opposite of what a risk table alone
would say. A crew locked out mid-job writes the passphrase on the dashboard, and
then the control is worse than none. What holds the risk down there is the
reach: the Minimum Necessary Emergency Profile, under a live incident the
account is attached to, ending when the incident does.

The controls below hold for all four.

- **No token in the browser.** The portal renders on the server and holds the
  resident's access and refresh tokens itself. The browser gets a cookie
  containing an AES-256-GCM sealed session and nothing else — `HttpOnly`,
  `SameSite=Strict`, and `Secure` wherever it is deployed. A cross-site scripting bug in the portal therefore
  does not yield a token, because there is none in the page to take. See
  [ADR 0005](adr/0005-portal-holds-the-session.md).
- **CSRF.** Mutations are Server Actions, which are rejected when the
  submission's origin is not the portal's own; the same-site cookie is the second
  layer.
- **A desk-issued passphrase cannot stay in use.** The account is flagged at
  issue, and every signed-in page redirects to the change-passphrase form until
  it is replaced. Replacing it ends every other session. Until this phase this
  held for residents only: `government_user.must_change_password` was set at
  account creation, the login endpoint reported it, and no endpoint could clear
  it — so every officer account ran indefinitely on a secret an administrator
  also knew.
- **Step-up is handled, not worked around.** An operation that changes the
  register or somebody's access to it requires a session re-proved minutes ago,
  not one proved this morning and left open on a counter. The government,
  security and emergency portals send the officer to re-authenticate and return
  them to the task, and the return address is refused unless it is a path within
  the application.
- **Sign-in reveals nothing.** A wrong passphrase and an identifier that was
  never issued produce the same message, so the page cannot be used to find out
  which Plateau Citizen IDs exist.
- **The QR discloses nothing.** It carries an opaque token that expires in five
  minutes and that only an authenticated officer holding the verification action
  can resolve — into a name and a valid/not-valid answer, and nothing else.
- **Headers.** A restrictive CSP with no third-party origin at all,
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy:
no-referrer`, `nosniff`, geolocation permitted only to the page itself, and
  `noindex` on every page.
- **Location is opt-in and provenance travels with it.** The only coordinate the
  portal can send is one a resident explicitly chose to share when raising an
  emergency, and it is stored marked `CALLER_SUPPLIED` with a retention date
  (§16).

`apps/portal/e2e/security.spec.ts` asserts the properties above against the
running build — including that no JWS and no bearer header appears in the HTML of
any page, and that every signed-in route is unreachable without a session.
`apps/government/e2e/entitlements.spec.ts` does the equivalent for an officer:
that the menu offers only what the account holds, and that typing the address of
a page it does not hold produces nothing.

`apps/security/e2e/` runs three officers of one agency — an investigator, a
supervisor and a missing-person desk — through the same portal, because the
property that matters most here is that belonging to the Police Command is not
the same as being on the case. It asserts that a record cannot be opened without
one; that a person not linked to the case is refused in the same words as a
person who does not exist; that an investigator cannot close their own case; and
that a closed case authorises nothing further, including its own file.

`apps/emergency/e2e/` runs the same idea for the incident: control, a crew, and
a fleet office. The fleet office is the one worth having — "a technical role
carries no entitlement to citizen data" (§7) is a claim the platform makes about
itself, and that project walks the account that can put an ambulance on the road
at every page that would show it a person, and requires it to find nothing.

## Verified by tests

[`services/api/test/integration/security.test.ts`](../services/api/test/integration/security.test.ts)
attempts each of these and asserts it fails: unauthenticated access, empty and
malformed credentials, an `alg: none` token, a token signed with another key, a
tampered payload, an expired token, privilege retention after role removal,
session reuse after sign-out, IDOR between citizens, six SQL injection payloads
across every reachable string input, audit alteration and deletion, PCID deletion,
oversized pages, repeated searching, password guessing, second-factor guessing,
self-administration, and error-message leakage.

[`packages/policy/test/critical-authorization.test.ts`](../packages/policy/test/critical-authorization.test.ts)
and [`services/api/test/integration/authorization.test.ts`](../services/api/test/integration/authorization.test.ts)
prove the seven propositions of §75 at the engine and at the HTTP boundary.

[`apps/portal/e2e/security.spec.ts`](../apps/portal/e2e/security.spec.ts) does the
same for the portal in a real browser, against the standalone build the container
runs.

## A device may hold something, and only just

The controlled offline mode (§56) is the one place this platform keeps data
outside itself, and the threat it answers is narrow: a responder at a roadside
with no signal who still has to know whether the casualty is diabetic.

What makes it defensible is not the encryption on its own — it is that six things
are true at once, and [mobile.md](mobile.md) names the place each is enforced.
The two worth repeating here:

**The bundle carries no authority.** It is data the platform already released to
that person, never a token, never a key, never a way to ask for more. The device
secret that goes with it authenticates nothing: presented without a signed-in
session belonging to the same account, it is refused. So a stolen phone yields
what its holder could already read for a few hours, and not a route into the
register.

**The encryption protects storage, not use.** The key is generated
`extractable: false`, so an image of the device's storage, a phone backup or
another application reading the profile directory get ciphertext. It does _not_
protect against somebody using the phone while it is unlocked — nothing in a
browser can — which is why the expiry is hours, the content is minimal, and
signing the device out revokes its sessions and invalidates its releases in one
act.

The service worker is held to the same line: it caches the page furniture and
never an authenticated response, because the browser's HTTP cache is neither
encrypted, nor bounded in time, nor revocable. Both portal suites assert that no
page about a person is in it after a full journey.

## Searching is bounded, and that is a control

A search of the register that matches more than a thousand people is refused,
with the response saying what to add. It reads as a performance measure and it is
one — ordering a quarter of a million people to show twenty is work proportional
to the register, and any officer could ask for it. But the reason it is in this
document is that a surname against a register of four million is not an
identification, and paging through the result is browsing the register. The
platform has no bulk export and no browse-all view by design; an unbounded name
search was the hole in that.

The per-account ceiling (twenty searches a minute) and the rolling volume alert
still apply on top. This bounds the size of a single answer; those bound how many
answers an account may ask for.

## Not covered yet

Stated plainly, because a security document that only lists strengths is not one:

- **No independent security assessment or penetration test has been performed.**
  The tests here are written by the same process that wrote the code, which is
  necessary but not sufficient.
- **Load testing is done but not on production hardware.**
  [load-testing.md](load-testing.md) records a four-million-record run and the
  five defects it found. What it could not establish is capacity on the hardware
  the state will buy: everything there shared four cores with the load generator.
  The rate limits are now measured rather than reasoned; the pool sizes are not.
- **No device attestation.** A native application can ask the operating system to
  vouch that it has not been tampered with; a web application cannot. The
  platform compensates by never depending on the client being honest — a device
  registration authenticates nothing and an offline bundle carries no authority —
  but an attacker on a rooted phone with a live session is not detected as such.
- **Signed audit exports** are not implemented; the chain is verifiable in place
  but there is no externally anchored proof.
- **API client authentication** is modelled (`api_client`, scopes, IP ranges) but
  the mutual-TLS and client-credentials flow is not implemented; today all callers
  are interactive sessions.
- **Key rotation** is supported by the ciphertext format but there is no rotation
  runbook or tooling.
- **Anomaly detection** covers search volume and break-glass use. The wider
  behavioural detection §32 envisages is configured but not implemented.
- **Secrets management** is assumed to be provided by the deployment platform;
  this repository defines the interface and never carries a secret.
- **Portal session-key rotation** signs everyone using that portal out. The ciphertext format
  carries a version, so a two-key window is possible; it is not implemented.

## Reporting a vulnerability

Report to the Plateau State PCID Platform Office's security contact. Do not open
a public issue. Include the correlation id from any response involved.
