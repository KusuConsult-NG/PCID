# Retention and erasure

What this platform keeps, for how long, why — and what makes that a control
rather than a claim.

## The finding this phase started from

For eleven phases the retention schedule existed and nothing applied it.
`citizen.retention_policy` carried a default. `incident.location_retention_until`
was stamped on every incident at creation. [privacy.md](privacy.md) printed a
table of periods, with a sentence admitting the enforcement jobs were not
implemented. No code read any of it, and no row was ever erased.

That is worth naming precisely, because it is the second time this platform has
found the same shape of defect — the first was a rate ceiling that was documented
and enforced nowhere, found while building the offline mode. A control that
exists only in a document is worse than an absent one. An absent control is
visible as absent. A documented one is counted as present: by the officer who
reads the schedule, by the Data Protection Officer who signs off the assessment,
and by the regulator who is being told, in writing, that the platform does
something it does not do.

## The catalogue is the schedule

[`packages/contracts/src/retention.ts`](../packages/contracts/src/retention.ts)
holds every policy: what it covers, the period, what happens when the period
ends, and the reason the period is that. It is the single source of truth in the
same way the field catalogue is, and for the same reason — the answer to "what
does this platform hold about me, and until when?" should be readable in one
place by somebody who cannot read TypeScript.

Three things are held to it by tests rather than by review:

- **Every policy states a basis.** A schedule whose durations have no stated
  reason cannot be defended to a regulator and cannot be revised by anyone who
  did not choose them.
- **Every policy that disposes of something has a rule that does it.**
  [`retention-coverage.test.ts`](../services/api/test/unit/retention-coverage.test.ts)
  compares the catalogue against the rules in both directions. A policy added
  with nothing behind it fails the build — which is exactly the defect above,
  made impossible to reintroduce.
- **The number is used once.** `IncidentsService` reads the ninety days from the
  catalogue rather than declaring its own constant, so the period in the privacy
  notice, the date stamped on an incident and the cutoff the sweep applies cannot
  drift apart.

## The schedule

| What is held                                     | Kept        | Then                                         |
| ------------------------------------------------ | ----------- | -------------------------------------------- |
| The identity register and the PCID               | Permanently | Nothing — a statutory register is not erased |
| The audit trail and its chain                    | Permanently | Nothing — see below                          |
| Investigation case files                         | Permanently | Nothing — disposal is the agency's decision  |
| Where an emergency happened                      | 90 days     | Coordinates and address emptied              |
| The text of a notice, and the address it went to | 90 days     | Emptied; the row and its delivery date stay  |
| Expired and revoked sessions                     | 30 days     | Deleted                                      |
| Sign-in attempts                                 | 90 days     | Deleted                                      |
| One-time credential tokens                       | 7 days      | Deleted                                      |
| Gateway delivery attempts                        | 90 days     | Deleted                                      |
| The ledger of what left on a device              | 1 year      | Deleted                                      |
| Counters behind sensitive-action limits          | 7 days      | Deleted                                      |

The periods, and the reason behind each, are in the catalogue and on the
Retention page in the government portal. Three of these rows say "permanently",
and they are on the same table as the rest deliberately: a schedule listing only
what expires reads as though everything else was forgotten rather than decided.

### Why delete sometimes and empty sometimes

An incident is a public-safety record. That an emergency happened, what kind it
was and how it was handled is worth keeping; exactly where somebody was at the
time stops being worth keeping once the response and any review of it are over.
So the incident survives and its location does not. `location_source` survives
too — how a coordinate was obtained is a fact about the platform's own conduct,
and an oversight review still needs it after the coordinate has gone.

A notice is the same shape. That a resident was told something, and when, is part
of the record — somebody disputing a decision has to be able to show they were
never notified. The wording and the telephone number are a second copy of
personal data whose purpose ended when the message arrived. So the row stays and
says its content was erased, rather than going blank: blank reads as "nothing was
ever sent", which is a different and wrong answer to the question being asked.

## What the sweep cannot reach

The audit trail, the identity register and the case files, and this is enforced
three times over rather than by the sweep being careful:

1. **The catalogue** marks all three KEEP, and a rule may not name a KEEP policy.
2. **The rules** are a closed list naming one table each, and a unit test asserts
   that list excludes `citizen`, `pcid_allocation`, `audit_event`,
   `audit_chain_head`, `investigation_case` and the rest.
3. **The database** grants `pcid_app` DELETE on the operational tables and
   nothing else, and `audit_event` carries three triggers refusing UPDATE, DELETE
   and TRUNCATE. A rule written to erase an audit event would fail at the
   database, where it should.

The third of those was written in phase three, long before there was a retention
sweep to refuse. That is the value of an append-only table: the guarantee holds
against code that did not exist when it was made.

`offline_release` is a fourth case worth naming. Migration 0015 gave the
application SELECT and INSERT on it and nothing else, so the record of what left
the platform cannot be removed by the code that writes it. The schedule still has
to reach it after a year, so it reaches it through one `SECURITY DEFINER`
function that erases by the schedule's cutoff and nothing else. A grant of DELETE
would have been three lines shorter and would have handed the whole application a
way to remove the evidence.

## The sweep

Nightly by default, because the periods are measured in days and an hourly sweep
buys hours at the cost of a write burst against tables that are busy all day. Run
it as its own process with `npm run worker:retention`, or set
`RETENTION_WORKER_ENABLED=true` to run it inside the API — the same trade as the
notification worker.

**Each rule is bounded.** The first sweep on a deployment that has been
collecting for a year meets a year of rows at once, and a single unbounded DELETE
against a few million takes a statement timeout with it — which the load harness
found the hard way in `--remove` during phase 10. So each rule erases at most
`RETENTION_BATCH_SIZE` rows, the run reports that more remains, and the next one
continues. The report matters: a sweep that erased 5,000 of 40,000 and said
"5,000" would be read as "there were 5,000".

**Each rule commits on its own.** One sweep in one transaction would hold locks
across every table for its duration and roll back six successful erasures because
the seventh met a timeout. Retention is idempotent — a row erased is a row no
longer due — so partial progress is progress. A rule that fails is logged, the
run is marked FAILED with the reason, and the other policies still get applied.

**The erasure and its ledger row commit together.** A sweep that erased rows and
then failed to record that it had would leave the Data Protection Officer unable
to say what happened, which is the one outcome worse than not having erased them.

## The ledger

`retention_run` records each sweep; `retention_erasure` records what each policy
took: the cutoff, the count, and whether the rule hit its batch. Both are
readable by the Data Protection Officer in the portal, and `retention_erasure` is
append-only in privilege and by trigger — a record of erasures that could itself
be edited would prove nothing.

It holds **counts and cutoffs, never contents, and never row identifiers.**
Recording which rows were erased would keep a pointer to every erased subject for
as long as the ledger is kept, which is a longer retention than the data itself
had; recording what they contained would defeat the erasure outright. What an
oversight review needs is that a sweep ran, under which policy, to which cutoff,
and how many rows it took — from which it can re-derive what should have gone.

## Who may do it

`RETENTION_VIEW` and `RETENTION_RUN`, both held by the Data Protection Officer
and by nobody else — not by a platform administrator. Applying a retention
schedule is how the platform discharges storage limitation, and §7 is explicit
that administering the servers confers no entitlement over citizen data. Erasure
is the least reversible thing this platform does, and the person answerable for
it should be the person who can order it.

Running it needs a step-up authenticated session. Reading the schedule is audited
too, which is not ceremony: the schedule states, for every category of data the
platform holds, how long it is held and why. That is a map of the estate, and
reading it is worth a line in the trail for the same reason searching the
register is.

The portal offers two buttons, and the destructive one is never the default: a
dry run counts what would go and erases nothing, and the API defaults to
`dryRun: true` for the same reason. A form that erases by omission is a form
somebody will submit by accident.

## What is not done

- **No per-record legal hold.** A case that needs an incident's location longer
  moves that incident's `location_retention_until`, and the sweep honours it —
  but there is no first-class "hold this record, it is in litigation" marker with
  its own audit trail and expiry. For a pilot, moving the date is enough; for a
  platform under regular disclosure requests it would not be.
- **No erasure of a suspended account's operational data on a shorter clock.**
  The schedule is by category, not by subject.
- **The first live sweep on a loaded deployment has not been measured.** The
  batching is what makes it safe in principle; what it costs against a real
  backlog on production hardware is in the same category as everything else in
  [load-testing.md](load-testing.md#what-this-does-not-establish).
