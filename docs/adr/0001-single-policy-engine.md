# ADR 0001: One policy engine, pure and outside the service

**Status:** Accepted

## Context

The platform must enforce role, agency, purpose, classification, jurisdiction,
case assignment, incident assignment, approvals and break glass — on every access,
down to individual fields. The obvious approach is guards and conditionals in each
route.

That approach fails predictably. Rules drift between routes; a new endpoint
implements eight of the nine checks; and nobody can state what the system's
authorisation model actually _is_, because it is distributed across fifty files.

## Decision

One engine, in `packages/policy`, with no I/O at all. Callers gather the evidence
and pass it in; the engine returns a decision, the fields released, the fields
withheld with reasons, and the obligations the decision carries.

The API has a single enforcement point that every route goes through.

## Consequences

**Good.** The authorisation model is one file you can read. It can be tested
exhaustively without a database — the §75 propositions are unit tests. A new
endpoint cannot forget a check, because it does not implement any. A decision can
be explained, which is what makes an access request queue and a denial message
useful.

**Costs.** Callers must gather evidence before deciding, so a request that turns
out to be refused has already loaded the case and the incident. At this scale that
is a few indexed queries, and the alternative is deciding without the evidence.

The engine cannot make a decision requiring data the caller did not supply. That
has proven a feature: it forces the evidence a decision depends on to be explicit.
