# Deployment

## Topology

```
            Internet / government network
                        │
                  API gateway (TLS, WAF, allow-listed origins)
                        │
          ┌─────────────┴──────────────┐
   Portal instance             API instance
   Portal instance             API instance          (stateless, ≥2 each)
          └─────────────┬──────────────┘
                        │
        ┌───────────────┼────────────────┐
   PostgreSQL 16     Redis           Secrets manager
   (primary +        (replicated)    (keys, credentials)
    standby)
```

Both tiers are stateless. Scaling out is adding instances; there is no local
state in either container and nothing that assumes a single process.

The portal reaches the API over the internal network and is the only thing that
needs to. It holds no database credential and no connection to PostgreSQL or
Redis: everything it knows, it asked the API for, as the resident signed into
it.

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

Rotating `PORTAL_SESSION_KEY` invalidates every portal session, which signs every
resident out. Nothing else is lost: the cookie is the only thing sealed with it.

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
```

The API runtime image carries compiled JavaScript, production dependencies and
the migration files. The portal image carries the standalone server, the
dependencies Next traced for it, and the static assets. Neither carries source,
fixtures or a build toolchain; both run as `node`, not root, and should be
deployed read-only with a tmpfs at `/tmp`, no new privileges, and all
capabilities dropped — `docker-compose.yml` shows the shape.

The portal image needs no secret to build. Its configuration is read at the point
of use, so the same artefact is promoted from staging to production unchanged.

## Health checks

| Endpoint               | Use                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `/api/v1/health/live`  | Liveness. No dependency checks; restart if it fails                                      |
| `/api/v1/health/ready` | Readiness. Returns 503 when the database or counter store is unreachable                 |
| `/sign-in` (portal)    | The portal has no dependency of its own to check; serving its sign-in page is the signal |

The identity service is mission-critical, so an instance that cannot reach the
database removes itself from the load balancer rather than serving errors.

## Gateway

Terminate TLS at the gateway and require TLS 1.2 or better. The API sets
`trust proxy` to exactly one hop, so `X-Forwarded-For` from the gateway is
honoured and a client cannot spoof its own address into the audit record — the
gateway must therefore be the only thing that can reach the instances.

CORS is closed by default; allow-list the portal origins at the gateway. Apply
gateway-level rate limiting in addition to the application's.

The portal sets its own security headers, including a Content-Security-Policy
with no third-party origin at all. Do not let the gateway relax them, and do not
add an analytics or tag-manager origin to that policy: it would be a third party
inside a page that renders a citizen's record.

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
- [ ] `PORTAL_SESSION_KEY` distinct from both API keys, from the secrets manager
- [ ] Portal reaches the API over the internal network only
- [ ] `PORTAL_ALLOWED_ORIGINS` lists exactly the portal's public origins
- [ ] Portal served over TLS, so its session cookie is accepted as `Secure`
- [ ] Load testing performed — **not yet done**
- [ ] Independent security assessment performed — **not yet done**

The last two are open. The platform should not carry live citizen data until they
are closed.
