# ADR 0003: The platform projects records, it never owns them

**Status:** Accepted

## Context

The platform links records held by the lands registry, the revenue service, the
transport authority and others. It could copy them and become the system of
record, or hold references and call each agency live, or hold a synchronised
projection.

Becoming the system of record would make the platform authoritative for data it
has no authority over, and would turn every agency's correction process into a
two-system problem. Calling live would make emergency identification depend on
the availability of every agency it touches.

## Decision

The platform holds a **projection** of each record, stamped with the source
agency, source system, source record id, when the source last changed it, when
the platform last synchronised, and a verification status.

- Reads are served from the projection and report how stale it is.
- Adapters are used only by synchronisation jobs, never on a read path.
- There is **no write endpoint for a projected record at all**. A correction
  becomes a request routed to the owning agency.
- A PCID a source cites that the registry does not hold raises a data conflict for
  review rather than creating a link.

## Consequences

**Good.** The source agency stays authoritative, which is both correct and what
makes agencies willing to connect. An agency outage degrades freshness, not
availability — emergency response does not stop because a registry is down, and
the test suite proves it. Provenance is always visible, so an officer knows how
old a vehicle alert is.

**Costs.** Data can be stale, so `stale` must be shown in every interface and
respected in every decision made on it. Synchronisation has to be operated and
monitored. Two agencies disagreeing produces conflicts that need human
resolution — which is a real cost, and also the honest representation of a real
disagreement.
