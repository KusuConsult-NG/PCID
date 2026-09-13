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

## Not covered yet

Stated plainly, because a security document that only lists strengths is not one:

- **No independent security assessment or penetration test has been performed.**
  The tests here are written by the same process that wrote the code, which is
  necessary but not sufficient.
- **No load testing** against statewide volumes. The rate limits and pool sizes
  are reasoned defaults, not measured ones.
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

## Reporting a vulnerability

Report to the Plateau State PCID Platform Office's security contact. Do not open
a public issue. Include the correlation id from any response involved.
