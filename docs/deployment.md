# Deployment

## Topology

```
            Internet / government network
                        │
                  API gateway (TLS, WAF, allow-listed origins)
                        │
          ┌─────────────┴──────────────┐
   Citizen portal              API instance
   Government portal           API instance          (stateless, ≥2 each)
   Security agency portal      Notification worker   (≥1, no HTTP surface)
   Emergency response portal   Retention sweep       (1, nightly)
          └─────────────┬──────────────┘
                        │
        ┌───────────────┼────────────────┐
   PostgreSQL 16     Redis           Secrets manager
   (primary +        (replicated)    (keys, credentials)
    standby)
```

Both tiers are stateless. Scaling out is adding instances; there is no local
state in either container and nothing that assumes a single process.

The portals reach the API over the internal network and are the only things that
need to. None holds a database credential nor a connection to PostgreSQL or
Redis: everything they know, they asked the API for, as the person signed into
them.

The government portal should be reachable only from the government network, the
security agency portal only from the security network within it, the emergency
portal from the government network and from the mobile network the crews' devices
use, and the citizen portal from the public internet. That is a gateway decision, not an
application one — the platform authorises identically either way — but it is the
cheapest additional control available and there is no reason not to take it.

### The portals serve their own static assets

Each portal's standalone build carries its `public/` directory, which now holds a
service worker and the icons a device uses when the portal is installed to a home
screen. Two consequences for whatever sits in front of them:

- `/sw.js` must be served from the portal's own origin with a scope of `/`. A CDN
  in front is fine; a CDN that rewrites the path is not, because a worker served
  from `/assets/sw.js` cannot control `/`.
- `/sw.js` should not be cached hard. The browser revalidates it, but a proxy
  holding it for a week means a fixed worker does not reach the devices running
  the broken one. `Cache-Control: no-cache` is the right answer for that one file;
  the icons and `/_next/static/` are immutable and can be cached for a year.

## Configuration

Every value is validated at boot, and the process refuses to start on a bad one.
See [`.env.example`](../.env.example) for the full list. The values that matter
most:

| Variable                 | Notes                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| `DATABASE_URL`           | Connects as `pcid_app`, which owns no object                          |
| `DATABASE_SSL`           | `verify-full` in production; `disable` is refused                     |
| `REDIS_URL`              | **Required in production** so rate limits are shared across instances |
| `TOKEN_SIGNING_KEY`      | 32 bytes, base64url, from the secrets manager                         |
| `SECRET_ENCRYPTION_KEY`  | 32 bytes, base64url, **different** from the signing key               |
| `ALLOW_SANDBOX_ADAPTERS` | Must be `false` in production; `true` is refused                      |
| `AAL2_TTL_SECONDS`       | How long a step-up lasts. Shorter is safer and more annoying          |

And on the portal tier, which shares none of the above:

| Variable                     | Notes                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| `PORTAL_SESSION_KEY`         | 32 bytes, base64url, **different** from both API keys                     |
| `PCID_API_URL`               | Internal address of the API. Never a public one                           |
| `PORTAL_SESSION_TTL_SECONDS` | How long an idle portal session lasts before signing in again             |
| `PORTAL_ALLOWED_ORIGINS`     | The portal's own public origins; a Server Action from anywhere else fails |

Each portal has its own set of these, prefixed `PORTAL_`, `GOVERNMENT_PORTAL_`,
`SECURITY_PORTAL_` and `EMERGENCY_PORTAL_`. The keys must all differ: one key per
portal is what makes a stolen cookie from one useless against another.

The emergency portal's idle timeout is twelve hours, the longest of the four, and
that is deliberate rather than an oversight — see
[Security](security.md#the-portals). Do not shorten it without reading why.

Rotating a portal's session key invalidates every session in that portal, which
signs everybody using it out. Nothing else is lost: the cookie is the only thing
sealed with it.

Generate keys with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

No secret belongs in this repository, in an image, or in an environment file
committed anywhere. The platform reads them from the environment; the deployment
supplies them from its secrets manager.

## Database preparation

```sql
CREATE DATABASE pcid;
CREATE ROLE pcid_migrator LOGIN PASSWORD '...';   -- migrations only
CREATE ROLE pcid_app_login LOGIN PASSWORD '...' IN ROLE pcid_app;
ALTER DATABASE pcid OWNER TO pcid_migrator;
```

The application login must be a member of `pcid_app` and must **not** own
objects. That is what stops it dropping the audit triggers.

The cluster should run with `--data-checksums`, encryption at rest, automated
backups, point-in-time recovery, and a standby. Connections should be restricted
to the API's security group.

### Settings that are not the defaults

A packaged PostgreSQL ships a configuration sized for a laptop, and the register
is a multi-gigabyte table read at random.

| Setting                      | Suggested                        | Why                                                                        |
| ---------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `shared_buffers`             | 25% of RAM                       | The stock 128MB against a register of several gigabytes                    |
| `effective_cache_size`       | 60-75% of RAM                    | Tells the planner an index scan is affordable                              |
| `work_mem`                   | 16-64MB                          | Sized against `max_connections`; the stock 4MB spills modest sorts to disk |
| `max_connections`            | Pool size × instances + headroom | The API pools; the database should not also be a pool                      |
| `log_min_duration_statement` | `500`                            | A statement over half a second on these access paths is a defect, not load |

`log_min_duration_statement` is the one that pays for itself. Every defect load
testing found showed up in that log first.

### Two things an existing deployment must do once

Migration `0014` gives `audit_chain_head` its own vacuum settings, but it does not
reclaim what has already accumulated: three million audit events had left that
one row occupying 32MB, and `VACUUM FULL` on it takes an `ACCESS EXCLUSIVE` lock,
which stops every audited operation in the platform — which is to say all of
them. Run it in a maintenance window:

```sql
VACUUM (FULL, ANALYZE) audit_chain_head;   -- seconds, but it blocks everything
```

And verify the audit chain in ranges rather than in one statement. A full walk of
three million links takes about thirty-six seconds and will hit the statement
timeout; fifty thousand links take under a second:

```sql
SELECT max(seq) FROM audit_event;                 -- then walk it in blocks
SELECT * FROM verify_audit_chain(1, 50000);
SELECT * FROM verify_audit_chain(50001, 100000);
```

## Rollout

```bash
# 1. Migrate. Separate credential, separate job, runs to completion first.
DATABASE_URL=postgres://pcid_migrator:...@db/pcid npm run db:migrate

# 2. Seed reference data. Idempotent; reconciles roles to the declarations.
npm run db:seed

# 3. Bootstrap the first administrator. Once, on first install.
BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... npm run db:bootstrap --workspace services/api

# 4. Start the API.
node services/api/dist/main.js
```

Steps 1 and 2 are safe to run on every deploy. Step 3 reports that the platform is
already bootstrapped and changes nothing.

The bootstrap output includes the authenticator provisioning URI and recovery
codes, shown once. Record them before the terminal scrolls.

### Migration ordering

Migrations must complete before new instances start. The runner takes an advisory
lock, so a second migrator waits rather than racing.

For a rolling deploy, write migrations to be backward compatible with the version
already running: add columns nullable, backfill separately, and drop in a later
release. The runner refuses to re-apply an edited migration, so a correction is
always a new file.

## Container

```bash
docker build -t pcid-api:$(git rev-parse --short HEAD) .
docker build -f apps/portal/Dockerfile -t pcid-portal:$(git rev-parse --short HEAD) .
docker build -f apps/government/Dockerfile \
  -t pcid-government-portal:$(git rev-parse --short HEAD) .
docker build -f apps/security/Dockerfile \
  -t pcid-security-portal:$(git rev-parse --short HEAD) .
docker build -f apps/emergency/Dockerfile \
  -t pcid-emergency-portal:$(git rev-parse --short HEAD) .
```

The API runtime image carries compiled JavaScript, production dependencies and
the migration files. Each portal image carries the standalone server, the
dependencies Next traced for it, and the static assets. None carries source,
fixtures or a build toolchain; all run as `node`, not root, and should be
deployed read-only with a tmpfs at `/tmp`, no new privileges, and all
capabilities dropped — `docker-compose.yml` shows the shape.

The portal images need no secret to build. Their configuration is read at the
point of use, so the same artefact is promoted from staging to production
unchanged.

## The notification worker

Delivery runs as its own process:

```bash
npm run worker:notifications
```

It is the same image as the API with a different command — it serves no HTTP,
opens no port and holds no session — and `docker-compose.yml` shows the shape.
Run at least one; run more if the queue grows. Messages are claimed with
`FOR UPDATE SKIP LOCKED`, so the number of replicas is an operational decision
rather than a correctness one, and a worker killed mid-send leaves its message
claimable again after `NOTIFICATION_VISIBILITY_TIMEOUT_SECONDS` rather than
stuck.

A single-box deployment can set `NOTIFICATION_WORKER_ENABLED=true` and let the
API sweep on a timer instead. That is the exception, not the shape: a burst of
messages then competes with the request path for the same event loop.

Configure a gateway for every channel you intend to use. A channel with none
falls back to the logging sender, which `ALLOW_SANDBOX_ADAPTERS=false` refuses —
so a deployment that forgot to configure SMS reports nothing sent rather than
everything delivered, which is the safe direction to fail in.

Watch two things: the depth of `QUEUED`, and the count of `FAILED`. The
administration page in the government portal shows both, grouped by cause, along
with the oldest message still waiting.

## The retention sweep

The schedule that erases what is past its period runs as its own process too:

```bash
npm run worker:retention          # nightly, on a timer
npm run worker:retention -- --once  # one sweep, for a cron entry or a first run
```

Same image, different command. A single-box deployment can set
`RETENTION_WORKER_ENABLED=true` instead and let the API sweep on a timer.

**Run it somewhere.** Off everywhere means the schedule is not applied, which is
exactly the state this platform was in for eleven phases, and which the privacy
notice describes as something the platform does. The Retention page in the
government portal says "Never applied" in red until a sweep has run, so the
condition is visible to the Data Protection Officer rather than only in a config
file.

**Do a dry run first on a deployment carrying existing data.** The first live
sweep on a system that has been collecting for a year meets a year of rows, and
the counts it reports should be the ones you expected. Each policy is bounded to
`RETENTION_BATCH_SIZE` rows per run, so a large backlog is worked off over
several runs rather than in one statement that would take a timeout with it —
raise the batch, or run `--once` repeatedly, to work through it faster.

Nightly is the default because the periods are measured in days. An hourly sweep
erases the same rows a few hours earlier at the cost of a write burst against
tables that are busy all day.

## Health checks

| Endpoint               | Use                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `/api/v1/health/live`  | Liveness. No dependency checks; restart if it fails                                    |
| `/api/v1/health/ready` | Readiness. Returns 503 when the database or counter store is unreachable               |
| `/sign-in` (portals)   | A portal has no dependency of its own to check; serving its sign-in page is the signal |

The identity service is mission-critical, so an instance that cannot reach the
database removes itself from the load balancer rather than serving errors.

## Gateway

Terminate TLS at the gateway and require TLS 1.2 or better. The API sets
`trust proxy` to exactly one hop, so `X-Forwarded-For` from the gateway is
honoured and a client cannot spoof its own address into the audit record — the
gateway must therefore be the only thing that can reach the instances.

CORS is closed by default; allow-list the portal origins at the gateway. Apply
gateway-level rate limiting in addition to the application's.

Each portal sets its own security headers, including a Content-Security-Policy
with no third-party origin at all. Do not let the gateway relax them, and do not
add an analytics or tag-manager origin to either policy: it would be a third
party inside a page that renders a citizen's record.

## Observability

The service logs structured JSON on stdout. Log call sites carry identifiers and
outcomes, never record contents: operator logs must not become a second,
unguarded copy of citizen data. The audit table is where data access is recorded.

Worth alerting on:

- readiness failures, and database or Redis unavailability;
- authentication failure rate, and account lockouts;
- `429` rate, which usually means either an attack or a legitimate workflow the
  limits are too tight for;
- audit write failures — these fail requests, and should page;
- break-glass grants approaching their 24-hour review deadline;
- integration sync failures and projection staleness;
- p95 latency on the emergency identification path specifically.

## Backups

See [disaster-recovery.md](disaster-recovery.md).

## Pre-production checklist

Deliberately not a formality:

- [ ] `ALLOW_SANDBOX_ADAPTERS=false`, verified in the running process
- [ ] `DATABASE_SSL=verify-full` with the CA bundle mounted
- [ ] Signing and encryption keys distinct, from the secrets manager, never logged
- [ ] Application login is a member of `pcid_app` and owns nothing
- [ ] `SELECT * FROM verify_audit_chain()` returns no rows
- [ ] A restore has been performed into a scratch database **this quarter**
- [ ] Redis reachable; rate limits shared across instances
- [ ] Gateway is the only network path to the instances
- [ ] Every agency's data-sharing agreement status reflects a signed agreement
- [ ] Compartment grants reviewed, each with a stated legal basis
- [ ] Bootstrap administrator's recovery codes stored securely offline
- [ ] All six keys distinct, from the secrets manager, never logged
- [ ] Every portal reaches the API over the internal network only
- [ ] Only the citizen portal is reachable from the public internet
- [ ] `*_ALLOWED_ORIGINS` list exactly each portal's public origins
- [ ] Every portal served over TLS — their session cookies are accepted as
      `Secure`, and without it no device can be registered and no service worker
      will install: the offline mode simply does not exist on plain HTTP, which
      is the correct failure
- [ ] A gateway is configured for every channel in use, and a test message arrived
- [ ] At least one notification worker is running, and the queue depth is on a dashboard
- [ ] The retention sweep is running somewhere — its own process or
      `RETENTION_WORKER_ENABLED=true` — and the Retention page shows a run that
      is not "never". A schedule nothing applies is a claim made to a regulator
- [ ] A dry run has been done first on a deployment carrying existing data, and
      the counts it reported were the ones expected
- [ ] `shared_buffers`, `work_mem` and `log_min_duration_statement` set as above
- [ ] `VACUUM (FULL, ANALYZE) audit_chain_head` run once, in a maintenance window
- [ ] Load testing performed on **this deployment's** hardware, not only in CI
- [ ] Independent security assessment performed — **not yet done**

Load testing against a statewide register is done and is recorded in
[load-testing.md](load-testing.md) — including five defects it found and what it
does not establish. What it does not establish is capacity on the hardware the
state actually buys, which is why that line stays on this list.

The security assessment is open. The platform should not carry live citizen data
until it is closed.
