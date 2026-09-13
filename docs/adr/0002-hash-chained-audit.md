# ADR 0002: Hash-chained, append-only audit in the database

**Status:** Accepted

## Context

§25 requires immutable audit records. "Immutable" is easy to claim: a table
nobody is supposed to write to is not immutable, it is a convention.

Two properties are needed. Alteration must be _prevented_ where possible, and
_detectable_ where prevention fails — because someone with database access can
usually defeat prevention alone.

## Decision

Three layers:

1. **Triggers** refusing `UPDATE`, `DELETE` and `TRUNCATE` on `audit_event` and
   `pcid_allocation`.
2. **Privileges**: the application role owns no object and is not granted those
   rights, so it cannot drop the triggers.
3. **A hash chain**: each row carries `sha256(prev_hash || canonical_payload)`,
   computed by a `BEFORE INSERT` trigger so a caller cannot choose its own
   predecessor. `verify_audit_chain()` walks it and names the first disagreement.

The canonical payload function lives in the database, so verification does not
depend on an application being available.

An audit write failure fails the request. The platform would rather refuse a
lookup than perform one it cannot account for.

## Consequences

**Good.** Alteration by the application is impossible; alteration by a privileged
operator is detectable. The guarantee survives backup and restore, which the test
suite proves both positively and negatively. Verification works during an incident,
when the application may be exactly what is untrusted.

**Costs.** Inserts serialise on reading the previous hash, so the audit table is a
write bottleneck under extreme load. At state scale this is far from binding; if
it ever binds, the chain can be partitioned per period with a linking record, at
the cost of a more complex verifier.

Corrections are impossible by construction. A mistaken audit row stands, and the
correction is a new row referring to it. That is the intended behaviour of a
record of what happened.
