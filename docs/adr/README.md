# Architecture decision records

Decisions where the alternative was reasonable and the reasoning is worth keeping.
Each records the context, the decision, and the costs accepted — the costs
especially, because a decision recorded without them reads as advocacy rather than
as a record.

|                                             | Decision                                              |
| ------------------------------------------- | ----------------------------------------------------- |
| [0001](0001-single-policy-engine.md)        | One policy engine, pure and outside the service       |
| [0002](0002-hash-chained-audit.md)          | Hash-chained, append-only audit in the database       |
| [0003](0003-projections-not-ownership.md)   | The platform projects records, it never owns them     |
| [0004](0004-token-carries-identity-only.md) | Access tokens carry identity, not entitlements        |
| [0005](0005-portal-holds-the-session.md)    | The citizen portal holds the session, not the browser |

Add one when a future reader would otherwise ask "why on earth is it like this?".
