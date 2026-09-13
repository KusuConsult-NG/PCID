# Privacy and data protection

Written for the Data Protection Officer and for anyone assessing the platform
against the Nigeria Data Protection Act and the state's own obligations.

## Principles, and where each one is actually enforced

### Lawfulness and purpose limitation

Every request declares a lawful purpose from a closed list. The purpose is
checked against the action, and separately against each field, before anything is
released. There is deliberately **no general-browsing purpose**.

A field catalogued for emergency care is not released for revenue work. Not
discouraged — not released, by a check in
[`field-release.ts`](../packages/policy/src/field-release.ts).

### Data minimisation

The catalogue is the mechanism. Each field declares what it is for, and the
default for anything uncatalogued is "not released".

Three consequences worth naming:

- A **search** returns only identifying fields at INTERNAL classification or
  below. Enough to confirm you have the right person; not a way to read records
  without opening them.
- A **responder** receives the Minimum Necessary Emergency Profile and nothing
  else — including `approximateAge` in place of the exact date of birth, because
  age is what matters at a roadside and a date of birth is an identity credential.
- **Citizen 360** is a shape, not an entitlement. For most callers most cards come
  back restricted, and that is the intended outcome.

### Accuracy

Corrections are a workflow, not an edit. A citizen or an authorised officer
raises a request with a justification and evidence; it is reviewed and recorded.
For records another agency owns, the platform holds only a projection: the
correction routes to that agency, and the platform has no write path into their
system at all.

### Storage limitation

Every dataset carries a retention policy, and emergency location material carries
an explicit retention date set when the record is created.

| Data                        | Policy                                                      |
| --------------------------- | ----------------------------------------------------------- |
| Citizen identity            | Long-term government record, per applicable law             |
| Incident records            | Configured retention, default 90 days for location material |
| Security case records       | Configured legal retention                                  |
| Audit events                | Long-term, tamper-resistant                                 |
| Sessions and login attempts | Short, operational                                          |
| Emergency location          | 90 days unless a case requires longer                       |

Enforcement jobs for the shorter schedules are not yet implemented; the columns
and policies are in place and the retention dates are set on write.

### Integrity and confidentiality

See [security.md](security.md).

### Accountability

Every access produces an immutable, hash-chained audit record. The DPO can search
it by subject, actor, agency, action, outcome and time, and can verify the chain
has not been altered.

## Transparency to the citizen

A resident can see, in the citizen portal, which agency accessed their record,
when, for what purpose, and what kind of access it was.

Access made under an active criminal investigation is withheld, because telling
the subject of an investigation that they are being investigated defeats it. That
withholding is governed:

- it is never silent — the response says that some accesses may be withheld;
- every withheld event carries a **stated legal basis** in the audit record;
- the basis is visible to the Data Protection Officer, who can review whether the
  restriction was proportionate;
- the default is derived from the purpose, so a module that simply forgets cannot
  quietly expose an investigation _or_ quietly hide an ordinary access.

## Special categories

**Health data.** Blood group and disclosed critical conditions are classified
HIGHLY_RESTRICTED and catalogued for emergency purposes only. A health ministry
officer with the clearance does not receive them for a service-delivery purpose,
because the purpose is wrong. The citizen chooses what to disclose and can change
it.

**Biometrics.** The platform stores none and matches none. An unidentified-person
record may reference material held by an agency that has lawful authority and the
infrastructure for it; the reference itself is compartmented and approval-gated.
Introducing biometrics would need its own legal basis, its own module and its own
assessment.

**Location.** The platform holds no capability to locate a person. It
distinguishes a registered address (a government record), an incident location (an
observation about an event), and a unit position (reported by the unit itself).
Every coordinate records how it was obtained. `REAL_TIME_DEVICE` exists in the
provenance vocabulary as a reserved marker for a future, separately authorised
module; nothing writes it.

**Protected characteristics.** No query in the platform groups by ethnicity,
religion, political activity or similar, and no scoring model takes them as
input. Duplicate detection compares only the identifying attributes a
registration supplies; missing-person matching compares only observable physical
and circumstantial attributes.

## Automated decision-making

Two engines produce scores, and neither decides anything.

**Duplicate detection** returns candidates with every contributing factor and its
weight. A registration above the review threshold stops and waits for a person.
Records are never merged automatically.

**Missing-person matching** returns candidates with their reasoning. The engine
may only ever write `CANDIDATE`; a database check constraint refuses a `CONFIRMED`
match with no named human reviewer, so no code path — present or future — can
produce an automated identification.

Both attach an explanation answering "why am I seeing this?": the factors
considered, the weights, the confidence, the engine version and a note that a
candidate is not a finding.

Alerts describe records and events, never people. "Identity Integrity Alert", not
"Fraudster".

## Rights

| Right         | Today                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Access        | Citizen portal: own record and access history (API complete, portal not built)              |
| Rectification | Correction request workflow (complete)                                                      |
| Erasure       | Not applicable to a statutory identity register; the PCID allocation is permanent by design |
| Restriction   | Records can be suspended; per-field restriction is not implemented                          |
| Objection     | Handled administratively by the DPO                                                         |
| Portability   | Not implemented                                                                             |

## Roles

The **Data Protection Officer** holds audit and alert review actions and
correction review, and explicitly **no citizen-data read action**. They can see
who accessed what and on what basis without being able to read the underlying
records — which is what makes the oversight role credible.

Each agency records its own DPO in the Government Agency Registry.

## Data protection impact assessment

A DPIA is required before a pilot and is not in this repository. The material it
needs — the field catalogue, the classification model, the purpose bindings, the
retention schedule, the audit design and the automated-decision analysis — is all
here and referenced above.
