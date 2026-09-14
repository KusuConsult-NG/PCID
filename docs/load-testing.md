# Load testing

What the platform does when the register holds four million people, and what it
does when several hundred officers are working at once.

This is the record of that work: how it is measured, what was measured, what the
measurements found, and — most importantly — what they do **not** establish. Load
testing is one of the three things the roadmap says must happen before a pilot.
It is now done, and it found five defects that would have reached production.

## What was measured against

A synthetic register at the size of the real one.

| Table                | Rows      | Size   |
| -------------------- | --------- | ------ |
| `citizen`            | 4,000,000 | 1.9 GB |
| `audit_event`        | 3,000,000 | 2.1 GB |
| `pcid_allocation`    | 4,000,000 | 495 MB |
| `incident`           | 250,000   | 159 MB |
| `investigation_case` | 60,000    | 23 MB  |
| `response_unit`      | 400       | 264 kB |
| Whole database       |           | 4.9 GB |

Plateau State's population is around four and a half million, so four million
records is a register at full statewide coverage rather than a sample of one. The
250,000 incidents are about five years of emergency work at a hundred and forty a
day. The three million audit events are a few months of ordinary access at the
rates below — the audit trail grows faster than anything else in the platform,
because every access writes to it.

The data is generated, not copied: no real person's record is involved at any
point. Names are drawn from the language groups of Plateau State and combined
with a skew, so a few surnames are common and most are not — which matters,
because a trigram index over ten thousand copies of one name behaves nothing like
one over a real population. Every telephone number begins `0700`, a block no
Nigerian operator uses, so nothing generated can reach a handset.

Generation takes about fifteen minutes and is reproducible from a seed.

## What was measured on

Four cores, 16 GB, PostgreSQL 16 and Node 22 on one machine, with the load
generator on that machine too. **This matters, and it bounds what the end-to-end
numbers mean.** A production deployment runs the database on its own hardware and
several API instances behind a gateway; here all three compete for the same four
cores, and at a few hundred concurrent users the machine — not the platform — is
what runs out.

So the results are reported in two kinds, and only the first kind is a statement
about the platform:

1. **Per-operation cost**, measured inside PostgreSQL with `EXPLAIN (ANALYZE)`
   against the full dataset, and the audit chain's throughput measured directly.
   These are properties of the schema and the queries. They hold on any hardware,
   and they are what changes when a query is written badly.
2. **End-to-end behaviour** under a realistic mix of concurrent officers. On this
   hardware the absolute request rate is a floor, not a capacity figure. What it
   establishes is that the platform answers correctly under concurrency, which
   errors appear and where the cost is concentrated.

## Method

### The dataset

`npm run db:load-seed` writes registry rows directly, which is the one place in
the repository that bypasses the API — and it says so rather than hiding it. A
statewide population cannot be created through the registration endpoint in any
usable time, and a load test that takes a week to set up is a load test nobody
runs. The compensating controls are in the code and are worth repeating here: it
refuses to run when `NODE_ENV` is production; it refuses a database that already
holds registry rows it did not create; and every row it writes is marked, so
`--remove` is an exact undo.

### The accounts

One account per virtual user, up to eight hundred of them, each with its own
passphrase and its own authenticator. This is not fussiness. The platform limits
an account to twenty searches a minute, so a run driven through a handful of
shared logins measures the rate limiter and nothing else — as the first run
here did, before the harness was corrected.

### The mix

Fifteen scenarios across four desks, weighted as a working day: mostly
service-counter lookups, a steady background of the emergency board refreshing
itself, a smaller number of registrations, dispatches and case work. Two profiles
— `counter`, an ordinary day; `surge`, a major incident where the control room
carries half the traffic.

Each scenario declares which HTTP statuses count as an answer, because a refusal
is a correct outcome here: a case-bound search against a closed case is _supposed_
to be refused, and scoring it as an error would report a broken platform and bury
a real regression in the noise. The full status distribution is printed either
way, so a shift towards refusals is visible.

### The measurements

Closed loop: a fixed number of virtual users, each issuing one request at a time,
with a think time between requests. Stated plainly because it decides what the
numbers mean — a closed loop cannot build a queue the server has no chance of
clearing, so it answers "what does the platform do at this concurrency" and not
"what happens when ten thousand people arrive at once". That second question is
answered by the rate limiter, not by this harness.

Percentiles are nearest-rank on every sample, not interpolated and not sampled:
a reported p99 of 240ms means a request actually took 240ms. The first seconds of
each run are discarded, so the report does not include the requests that filled
the connection pool and planned every statement for the first time.

## What it found

Five defects, all of them invisible at development volumes and all of them fixed
here. Three are in the register's hot paths, one is in the audit trail's
housekeeping, and one would have locked officers out of the platform on the first
morning.

### 1. Searching the register read the whole register

`GET /api/v1/citizens?name=…` matched with a trigram operator and ordered the
result alphabetically. At four million records a surname matches about two
hundred and thirty thousand people and a whole name about a hundred and ten
thousand, and the query had to sort all of them to return twenty. It also ran a
`count(*)` over the same predicate, doubling the cost.

Measured before, for a name with nothing beside it: **2,571ms** for the page and
**2,611ms** for the count — over five seconds of database time, reading the
entire table twice. The planner would sometimes choose a bitmap index scan
instead, at 402ms, which made the same search four hundred milliseconds or two
and a half seconds depending on which plan the connection had settled on. An
operation whose cost varies six-fold for the same input is not a fast operation
with an occasional blip; it is an unpredictable one.

A name _with a date of birth beside it_ was already fine — 2.8ms, because the
date index does the work and the name only filters what it returns. That is the
shape of the defect: it was not that search was slow, it was that a search with
no selective criterion in it was unbounded, and nothing refused one.

Three changes, and their order is the point.

- **Count first, and only as far as it matters.** `LIMIT 1001` inside the count
  lets the scan stop as soon as it has found that many. Discovering that a search
  is too broad now costs between **32ms and 190ms** — the commoner the name, the
  sooner the scan has seen a thousand and one of them — rather than 2.6 seconds.
- **Refuse a search that matches more people than anybody could look through.**
  Partly cost — ordering a quarter of a million people to show twenty is work
  proportional to the register, and any officer could ask for it. Mostly though it
  is the right answer: a surname against a statewide register is not an
  identification, and paging through the result is browsing the register, which is
  the thing this platform exists not to allow (§63). The refusal names what to
  add, and names only what actually narrows a register of four million: the date
  of birth, a telephone number, or the Plateau Citizen ID. A Local Government
  Area sounds like it would help and does not — the largest holds several hundred
  thousand people.
- **Order what remains by closeness, not alphabetically.** `ORDER BY
display_name <-> $1` over at most a thousand candidates, which is a sort of a
  thousand rows and costs nothing. It is also the better answer: an officer who
  types a name wants the closest matches, not the twenty whose first names happen
  to begin with A. (The first attempt at this added an index to answer the
  ordering from, which turned out to be a mistake — see the next finding.)

Measured after: the search a counter actually makes — a name with the date of
birth the person has just given — is **1.3ms** for the page and the count
together. What changed is the unbounded case: a bare name is refused in
milliseconds instead of being served in five seconds, and no officer can ask the
register to sort a quarter of a million people.

### 2. A trigram index made one search in twelve a hundred times slower

This one was introduced by the first attempt at the fix above, which is why it is
here: a GiST trigram index on `display_name`, added so that ordering by closeness
could be answered from the index.

Timing the counter's own search — a name with a date of birth — for twelve
sampled people gave eleven results between four and six milliseconds, and one at
**1,204ms**. The plan for the slow one:

```
Bitmap Index Scan on citizen_dob_idx                 185 rows      0.03ms
Bitmap Index Scan on citizen_display_name_trgm_gist  39,761 rows   1,072ms
```

The planner had costed that second scan at 353 and it took a second. It also
contributed nothing: the date index had already found the right hundred and
eighty-five rows, and the trigram scan only intersected with them. The GIN index
on the same column behaved the same way against a ward or Local Government Area
filter, costing 822ms to narrow nothing.

Both are gone. Once a search's result set is bounded to a thousand rows, sorting
those thousand by trigram distance is free, and neither index earns the 542MB it
occupies or the write it adds to every registration. The trigram indexes on
`given_name` and `family_name` stay, because duplicate detection matches on those
and its query is narrowed by the date of birth first.

Measured effect on the same twelve searches after removal: **all twelve between
four and six milliseconds**, and no outlier. In a twenty-five officer run the p99
fell from **3,173ms to 166ms**.

This is the kind of defect load testing exists for. It was fast in every unit
test, fast in every end-to-end test, fast in nine out of ten manual tries, and a
second the tenth time — with no way to reproduce it on demand, because which plan
you get depends on the name you typed.

### 3. Duplicate detection had stopped working before it became slow

Before a PCID is issued, the registration path looks for an existing record that
might be the same person. It gathered candidates with
`similarity(family_name, $2) > 0.3`.

A function call is not an index condition, so every registration read the whole
register: **1,300ms**, on the one path that must never be skipped.

The more serious problem is what it returned. A surname net over a statewide
register matches a couple of hundred thousand people; the query then took an
arbitrary fifty of them by surname similarity. A real duplicate — same surname,
same first name, same date of birth — was very likely not among the fifty that
came back. The control had quietly stopped working, and nothing would have
reported it: registrations would have gone through cleanly, and the duplicates
would have accumulated in the register.

The net is now the surname paired with the date of birth, plus exact lookups on
the national identifier, the telephone number and the email address. That loses
nothing: without an exact date-of-birth agreement, the most a record can score on
names and locality together is 45, and the review threshold is 60. The arithmetic
is asserted by a test rather than remembered, so raising a weight without widening
the net fails the build.

Measured after: **0.42ms**, from 1,300ms.

### 4. The audit chain's single row grew to 32MB

The chain head is one row, updated once per audited operation. Autovacuum's
defaults assume a table where a few per cent of rows change; here a hundred per
cent of the table changes several hundred times a second. Three million audit
events left that row occupying **32MB** of dead versions. `VACUUM FULL` took it
back to 32kB.

It now has its own vacuum settings — after twenty-five updates, with no cost
delay, because it is one page and the busiest one in the platform.

### 5. The sign-in limiter would have locked out an office

Sign-ins were rate limited by network address as well as by account: fifty
attempts per address per fifteen minutes. A ministry's staff share one public
address behind their gateway, so the fifty-first person to arrive for the morning
shift would have been refused — not because anything was wrong with their
account, but because fifty colleagues had already signed in correctly.

The harness found it at two hundred and eighty accounts. A busy registry would
have found it on the first morning, and the symptom — "the system says too many
sign-in attempts" — would have been blamed on the account, not the gateway.

The address budget now counts **failed** sign-ins rather than sign-ins. That keeps
what the control was for: credential stuffing from one source is a stream of
failures and still trips it, while a shift change is a stream of successes and
does not. Brute force against one account is bounded separately, by a per-account
budget that no shared address affects.

## The access paths at four million records

Read with `EXPLAIN (ANALYZE)` against the full dataset, after the fixes above.
This is the table that extrapolates: a plan that reaches its rows through an index
still does at eight million, while a sequential scan grows with the register.

| Query                                     | Time    | Access path                                    |
| ----------------------------------------- | ------- | ---------------------------------------------- |
| Citizen view by PCID                      | 0.012ms | `citizen_pcid_key`                             |
| Citizen access history (a resident's own) | 0.013ms | `audit_event_subject_pcid_idx`                 |
| Citizen search, exact PCID                | 0.015ms | `citizen_pcid_key`                             |
| Incident board, active only               | 0.026ms | `incident_reported_at_idx`                     |
| Audit search by action, newest first      | 0.099ms | `audit_event_occurred_at_idx`                  |
| Duplicate detection, candidate net        | 0.435ms | `citizen_dob_idx`, `citizen_phone_primary_idx` |
| Counter search, bounded count             | 0.626ms | `citizen_dob_idx`                              |
| Counter search, name + date of birth      | 0.673ms | `citizen_dob_idx`                              |
| Incident board, count companion           | 8.1ms   | `incident_active_severity_idx`                 |
| An officer's caseload                     | 15.0ms  | `case_assignment_user_idx` + join scan         |
| Command map, bounding box                 | 23.0ms  | `incident_position_idx`                        |
| Search refused: a name on its own         | 187ms   | sequential scan, stopping at the cap           |

**The search a service counter makes costs 1.3ms** — the page and the bounded
count together.

Two entries are sequential scans and both are deliberate. The refusal path scans
until it has found a thousand and one matches and then stops, so the commoner the
name the sooner it stops: a surname shared by two hundred thousand people is
answered in 36ms, a whole name shared by a hundred and ten thousand in 187ms. It
is bounded either way, the answer is "too many", and building an index to serve
it faster would be building an index for a query the platform refuses to answer. The caseload query builds a hash over
`investigation_case`, which is an ordinary plan for a join of that shape; it grows
with the case table rather than with the register, and at sixty thousand cases it
costs fifteen milliseconds — worth revisiting at ten times that.

## The audit chain is the platform's ceiling

Every audited operation takes a row lock on the single `audit_chain_head` row and
holds it until its transaction commits. That is deliberate and it is right — a
chain that forks under concurrent writers is worse than no chain at all, and
[0011](../db/migrations/0011_audit_chain_serialisation.sql) sets out why. But it
means the platform's audited write rate has one number, and that number does not
improve by adding API instances.

Measured directly:

| Writers        | Rate            | p50 | p95  | p99  | max   |
| -------------- | --------------- | --- | ---- | ---- | ----- |
| 1 connection   | 1,159 inserts/s | 1ms | 1ms  | 2ms  | 4ms   |
| 16 connections | 1,282 inserts/s | 6ms | 42ms | 63ms | 121ms |

**About 1,300 audited operations per second, platform-wide.** Concurrency buys
about ten per cent, because after that the writers are queued behind each other — which
is the lock doing exactly what it is there for.

Is that enough? Plateau State has on the order of a few thousand government users
with access to citizen data. If two thousand of them are working at once and each
performs an audited action every ten seconds — a brisk pace for someone dealing
with a person in front of them — that is 200 operations a second, comfortably
inside the ceiling. The margin is about six-fold.

What would consume it: a bulk import writing an audit row per record, an
integration sync at high frequency, or a future citizen-facing feature that
audits a read on every page view. If any of those is planned, the chain is where
to look first, and the answer is not to weaken it — a plausible route is to batch
an import's audit into one event per batch with the record count in its detail,
rather than one per record.

Verifying the chain is now a ranged job. `verify_audit_chain()` over three million
links takes about thirty-six seconds, which exceeds the platform's statement
timeout; `verify_audit_chain(from, to)` over fifty thousand links takes 0.6s. The
operational procedure is to verify in ranges, and
[deployment.md](deployment.md) says so.

## End-to-end behaviour

Two profiles, each virtual user on its own account, each issuing a request every
three seconds — a brisk pace for somebody dealing with a person in front of them.

| Profile   | Officers | Requests       | Failures | p50  | p95   | p99   | max   |
| --------- | -------- | -------------- | -------- | ---- | ----- | ----- | ----- |
| `counter` | 25       | 744 over 90s   | 0        | 12ms | 90ms  | 166ms | 294ms |
| `surge`   | 60       | 1,781 over 90s | 0        | 14ms | 107ms | 154ms | 284ms |

Both within the service budget: no errors, p95 under 800ms, p99 under two
seconds. The status distributions carry no surprises — the 400s are the
deliberately over-broad searches the mix includes, answered as they should be;
the 403s are case-bound reads against cases that had closed, which is the binding
gate working. Nothing timed out, no connection was dropped, and the audit chain
verified intact afterwards.

The surge profile is the more interesting of the two, because the control room's
requests are the expensive ones — the command picture at 67ms, an incident with
its timeline and units at 93ms — and it still holds a p99 of 154ms while the
counters carry on beside it.

### What the tail looked like before

The same twenty-five officer run, before the trigram indexes were removed:

| Run                     | p50  | p95   | p99         | max         |
| ----------------------- | ---- | ----- | ----------- | ----------- |
| Before the index change | 14ms | 278ms | **3,173ms** | **3,775ms** |
| After                   | 12ms | 90ms  | 166ms       | 294ms       |

The median barely moved and the tail fell by a factor of nineteen. That is the
signature of the defect it fixes: not a slow operation, but an occasional
catastrophically slow plan for the same operation, which a mean would have hidden
entirely.

### Where this rig runs out

At higher concurrency the numbers stop being about the platform. A sweep taken
before the index fix — ten, twenty-five, fifty and a hundred officers — plateaued
at roughly 25-30 requests a second whatever the concurrency, while latency climbed
from 11ms to 1.7 seconds. Driving two hundred and eighty officers reached 26
requests a second at a p50 of 6.6 seconds. In every one of those runs the load
generator, the API and PostgreSQL were competing for four cores and the machine
sat at 100 per cent.

That plateau is a property of the rig, not of the software: the same build on the
same data, driven by a single client, answers at **p50 4ms** and sustains **222
requests a second**. The two reported runs above, at 8 and 20 requests a second,
sit well below where the rig gives out, which is why their latencies are the ones
worth quoting.

Neither figure is a capacity statement for a production deployment, where the
database has its own hardware and several API instances sit behind a gateway.
What the saturated runs do establish is worth having on its own: under sustained
overload on a four-million-record register the platform degrades by queuing
rather than by failing. Across every run at every concurrency, nothing errored
that was not a decision, nothing was dropped, every audit record was written, and
the chain still verified.

## Running it

```bash
# A database for measurement. Not a shared one: the seeder writes four million rows.
createdb pcid_load
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/pcid_load
npm run db:migrate && npm run db:seed

# The dataset and the accounts. About fifteen minutes at this size.
npm run db:load-seed -- --citizens 4000000 --incidents 250000 --cases 60000 \
  --units 400 --audit 3000000 --accounts 200

# The access paths and the audit chain's ceiling. Needs no API.
npm run load:probe -- --chain 2000 --concurrency 16

# The end-to-end mix. Needs the API running against the same database.
npm run load:run -- --users 100 --think 3000 --duration 120 --profile counter
npm run load:run -- --users 100 --think 3000 --duration 120 --profile surge

# Take it all out again.
npm run db:load-seed -- --remove
```

`load:run` exits non-zero when a run breaches the service budget — an error rate
above 1 per cent, a p95 above 800ms or a p99 above 2 seconds — so it can stand in
a pipeline as a gate rather than as a number somebody reads and forgets. CI runs
both profiles nightly against a smaller dataset sized to a hosted runner, where
what matters is the trend and the budget run after run on identical hardware,
never the absolute figures.

## What this does not establish

Said plainly, because a load-test document that reads as an all-clear is worse
than none.

- **Capacity on production hardware.** Everything here shared four cores. The
  per-query costs and the chain's ceiling carry over; the end-to-end request rate
  does not. Sizing needs a run on the hardware the state will actually buy, with
  the database on its own machine and the load generated from outside it.
- **Behaviour under a genuine burst.** A closed loop with think time models officers
  working; it does not model ten thousand arrivals in a second. That is the rate
  limiter's job and it is tested separately.
- **The portals.** The four portals are server-rendered and each page issues
  several API calls; this harness drives the API. A page's cost is roughly the sum
  of its calls, but that is an inference, not a measurement.
- **Sustained running.** The longest run here is a few minutes. Connection leaks,
  memory growth and index bloat are day-scale phenomena, and a pilot needs a soak
  test with the notification worker running alongside.
- **Anything about security.** Load testing is not a security assessment; the
  roadmap still names one, and it cannot be self-certified.
