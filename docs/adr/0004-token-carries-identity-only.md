# ADR 0004: Access tokens carry identity, not entitlements

**Status:** Accepted

## Context

The usual pattern embeds roles and permissions in the token, so authorisation
needs no lookup. It is fast, and it means an entitlement change takes effect only
when the token expires.

For a platform where "we revoked their access" has to be true the moment it is
said — a suspended officer, an agency whose agreement lapsed, a compromised
account — a window of minutes is not acceptable.

## Decision

The access token carries the subject, the session, the actor type and the
assurance level. Nothing else.

Roles, resolved actions, clearance, agency standing, the data-sharing agreement,
jurisdiction and access window are read from the database on every request, and
the AAL2 window is re-derived rather than trusted from the token.

## Consequences

**Good.** Revocation is immediate: removing a role, suspending an agency or
letting an agreement expire takes effect on the next call. An agreement expiry
needs no job — it is evaluated per request. Tokens stay small and carry nothing
sensitive. The security suite proves a removed role stops working on the very next
request.

**Costs.** A few indexed queries per request. Measured against the cost of an
account that keeps working after it was revoked, this is not a close decision.

If it ever becomes a bottleneck, the resolved subject can be cached for a few
seconds with explicit invalidation on entitlement change — but the default must
stay correctness, not speed.
