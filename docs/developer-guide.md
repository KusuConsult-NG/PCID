# Developer guide

## Setting up

Node 22, PostgreSQL 16, and the PostgreSQL client tools for the disaster-recovery
test.

```bash
npm install
export TOKEN_SIGNING_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export SECRET_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/pcid
export TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres

createdb pcid && npm run db:migrate && npm run db:seed
npm run dev:api
```

With the API up, `npm run db:demo` creates agencies, officers and a resident and
prints every credential it issued, so there is something to look at within a
minute. It goes through the same registration, duplicate-detection and audit
paths as anything else, and refuses to run against a production configuration.

The portal is a second process:

```bash
export PORTAL_SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export PCID_API_URL=http://127.0.0.1:3000
npm run dev:portal     # http://localhost:3100
```

The seed and the API must share `SECRET_ENCRYPTION_KEY`: authenticator secrets
are stored under an envelope, and a seed written with one key is unreadable to a
service holding another.

## Layout, and the dependency rule

```
packages/contracts   Vocabulary. Depends on nothing.
packages/policy      The engine. Depends on contracts only. No I/O.
packages/portal-kit  What the portals share: the sealed session, the API client,
                     the form controls, the design system. No platform logic.
services/api         Everything else. Depends on contracts and policy.
apps/portal          The citizen portal. Depends on portal-kit and on the API
                     over HTTP; on nothing else in this repository.
apps/government      The government portal. The same.
```

The rule is one-directional and worth protecting: `@pcid/policy` must never import
from `services/api`. Its value is that it can be reasoned about and tested
exhaustively without a database, and a single import would end that.

## Tests

```bash
npm run test:unit                                    # contracts, policy, security primitives
npm run test:integration --workspace services/api    # the API against a real database
npm run test:e2e                                     # the portal, in a real browser
npm run verify                                       # format, lint, typecheck, unit + integration
```

`verify` deliberately leaves the end-to-end suite out: it needs a browser, and it
is its own job in CI so a portal failure and a platform failure are told apart at
a glance.

Integration tests compile with `tsc` and run against the compiled output, because
esbuild-based loaders do not emit decorator metadata and Nest's dependency
injection needs it. Running them against `dist-test` means the suite exercises the
application that actually ships.

Each integration suite creates and drops its own database, so they are isolated
and can be run repeatedly.

### The end-to-end suite

`npm run test:e2e` runs both suites and needs nothing running. Each builds the
API, recreates a database of its own, starts the service and the portal's
standalone build on ports of its own (3400/3401 for the citizen portal,
3402/3403 for the government one), seeds them with `npm run db:demo -- --json`,
and drives Chromium through the journeys — then audits every page against WCAG
2.1 AA with axe.

Both run in ordered projects, and `provision` is always the first: it signs each
account in for the first time and makes it choose a passphrase, which is both the
first journey and how the other projects get a session. The government suite
then runs `registration`, `counter` and `oversight` as three _different_
officers, which is the point — an entitlement test that runs as one account
proves very little. `accessibility` runs last in both, so the pages it audits
hold the records the journeys created: an empty table hides most of the mistakes
a populated one makes.

Chromium has to be present: `npx playwright install chromium`. Playwright is
pinned exactly, because a minor bump expects a different browser revision than the
CI image carries.

Two things are deliberate and worth not "fixing". Nothing is stubbed, so a failure
usually means the platform refused something rather than that a selector moved.
And the portal is built and run the way the container runs it — the standalone
server, not `next start` — so the suite exercises the artefact that ships.

### The TOTP wrinkle

The platform refuses a TOTP time step at or below the last one used, which is
correct — a code should not work twice — and awkward for tests that sign in
several times inside one 30-second window. The harness tracks used steps per
secret and generates a code for the next step, which the server's ±1 window still
accepts. Only a burst of more than two sign-ins per secret has to wait.

If a test suddenly takes 30 seconds, that is why: share a session instead of
signing in again. Sharing is also the better assertion, since entitlements are
re-read per request.

## Adding a field

This is the change people get wrong, so it is worth doing in order.

1. **Migration.** Add the column. Never edit an applied migration — the runner
   compares checksums and refuses.
2. **Catalogue.** Add an entry to
   [`field-catalogue.ts`](../packages/contracts/src/field-catalogue.ts): its
   classification, the closed set of purposes it may be released for, whether it
   needs an approval, whether it is part of the emergency profile, whether the
   citizen sees it. **Until you do this, the field is unreachable** — which is the
   safe default.
3. **Mapper.** Add it to the resource's field-values mapper (for example
   [`citizen.mapper.ts`](../services/api/src/identity/citizen.mapper.ts)). This is
   the only place physical columns meet catalogue paths.
4. **Test.** Prove it is released for the purposes it should be, and withheld for
   the ones it should not.

Nothing else is needed. Services project through the decision, so a correctly
catalogued field appears for exactly the callers entitled to it.

## Adding an endpoint

```ts
documentRoute({
  method: 'get',
  path: '/api/v1/things/:id',
  tag: 'Things',
  summary: 'Read a thing',
  parameters: [
    { name: 'id', in: 'path', description: 'Thing id.' },
    { name: 'purpose', in: 'query', required: true, description: 'The lawful purpose.' },
  ],
});

@Get('things/:id')
async read(@Actor() actor: AuthenticatedActor, @Param('id') id: string,
           @Query() query: unknown, @Req() request: Request) {
  const input = validate(thingQuerySchema, query);
  return this.things.read(actor, id, input.purpose, contextOf(request));
}
```

In the service:

```ts
const outcome = await this.policy.authorize({
  actor,
  action: 'THING_VIEW',
  purpose,
  resource: {
    type: 'THING',
    id,
    classification: row?.classification ?? 'CONFIDENTIAL',
    subjectPcid: row?.subject_pcid ?? null,
  },
  context,
});
if (row === null) throw AppError.notFoundOrNotPermitted(`no thing ${id}`);
return {
  data: project(outcome.decision, thingFieldValues(row)),
  restrictedFields: withheld(outcome.decision),
};
```

Four things to keep:

- **Authorise before checking existence.** Then a record that does not exist and
  one you may not see are indistinguishable — and both are audited.
- **Never return a row object directly.** `project()` is the only supported way to
  turn a stored record into a response.
- **Add the route to
  [`routes-index.ts`](../services/api/src/common/openapi/routes-index.ts)** so it
  appears in the published contract.
- **Routes are authenticated unless marked `@Public()`.** Forgetting the guard
  fails closed.

## Adding an action

1. Add it to `ACTIONS` in [`actions.ts`](../packages/contracts/src/actions.ts).
2. Add its lawful purposes to `ACTION_PURPOSES` **and** its resource types to
   `ACTION_RESOURCE_TYPES` in
   [`action-metadata.ts`](../packages/policy/src/action-metadata.ts). A test
   asserts the two maps stay in lockstep, and an action missing from either is
   unusable — the safe failure.
3. Decide whether it reads citizen data (`CITIZEN_DATA_ACTIONS`), is a search
   (`SEARCH_ACTIONS`), needs case linkage (`CASE_LINKAGE_REQUIRED_ACTIONS`),
   addresses a case record (`CASE_RECORD_ACTIONS`), mutates
   (`MUTATING_ACTIONS`) or needs step-up (`STEP_UP_ACTIONS`).
4. Grant it to roles in [`roles.ts`](../packages/contracts/src/roles.ts). The seed
   reconciles roles on every deploy, so this is the change — not a SQL update.
5. Write the test that proves who may and may not use it.

## Changing the policy engine

Every change lands with a test, and the test should fail without the change.

The engine is pure, so a test is a fixture and an assertion — no database, no
HTTP. [`fixtures.ts`](../packages/policy/test/fixtures.ts) builds subjects,
resources and contexts.

Two rules that are not negotiable:

- **Gate order is deliberate.** Gates 1–13 are absolute; 14–16 are binding gates a
  break-glass grant may satisfy. Moving a gate between those groups changes what
  break glass can do, which is a security decision, not a refactor.
- **Never widen a decision outside the engine.** If a route needs something the
  engine refuses, the engine is where it is argued, reviewed and tested.

## Conventions

- **No `any`.** Lint enforces it. The authorisation model is expressed in types;
  `any` erases exactly the checking it depends on.
- **Every SQL value is a bind parameter.** Use
  [`WhereBuilder`](../services/api/src/common/sql.ts) for dynamic clauses — it has
  no way to interpolate a value, so a refactor cannot make a query injectable.
- **Operator logs carry identifiers and outcomes, never record contents.** They
  must not become a second, unguarded copy of citizen data; the audit table is
  where data access is recorded.
- **Comments explain why.** The what is in the code. Where a rule comes from the
  master system prompt, cite the section — it is what a reviewer needs.
- **Prefer a database constraint** where one can hold an invariant. Application
  code changes; a check constraint does not.

## Debugging

Every response carries `x-correlation-id`, which appears in the operator log and
on the audit record:

```sql
SELECT occurred_at, action, outcome, purpose, decision_reasons, fields_withheld
  FROM audit_event WHERE correlation_id = '<id>';
```

`decision_reasons` names the gate and code that refused, which is usually the
whole answer. `GET /api/v1/auth/me` shows what the account can actually do.

For an unexpected denial, the order of suspicion: is the agency active with a
signed agreement; is the authenticator confirmed; does a role grant the action; is
the purpose one that action allows; is the field catalogued for that purpose; is
there a case or incident and is the account on it.

## Working on a portal

Both portals render on the server and hold the session; see
[ADR 0005](adr/0005-portal-holds-the-session.md) for why. Three rules follow from
that and are worth keeping:

- **No API token reaches the browser.** Call the API from a Server Component or a
  Server Action, never from a client component. `apps/portal/e2e/security.spec.ts`
  asserts this on every page and will catch a regression.
- **Render what the API released, and say so where it did not.** A card the
  policy engine withheld is shown with `<Restricted>`, not omitted: an absent card
  and an absent record must not look the same (§29).
- **It has to work without JavaScript.** Forms are Server Actions and navigation
  is links. Reach for a client component only when there is no other way, as with
  the opt-in location control on the citizen portal's report page.
- **Anything shared goes in `packages/portal-kit`.** The platform's vocabulary
  does not: "Viewed your record" and "Opened a citizen record" are one audit row
  described to two audiences, and a shared label would be wrong for one of them.
  Each portal keeps its own `src/lib/vocabulary.ts`.

Where a page shows the same field in more than one form, give each control its own
`id` (`<Field name="fullName" id={...} />`). The name is what the action receives;
the id is what the label points at, and two labels pointing at the same id is an
accessibility failure the axe suite will fail on.

## Pull requests

- `npm run verify` and the integration suite pass.
- A change to either portal passes `npm run test:e2e`, including the
  accessibility audit.
- A new action is performed by a documented route, or is listed in
  `AWAITING_A_SURFACE` with the surface that will perform it named.
- Any authorisation change has a test that fails without it.
- Any new field has a catalogue entry and a release test.
- Migrations are new files, never edits.
- Nothing in the diff logs a record value.
- The API contract regenerates cleanly: `npm run openapi`.
