# Security agency guide

For investigators, supervisors and security agency administrators.

## The rule that shapes everything else

**Your authority comes from the case, not from your rank.** Being an investigator
in an authorised agency does not open the registry; being assigned to an active
case, and associating a person with that case, does.

That is what makes "who looked at this person, and under what authority"
answerable afterwards — which is what allows security agencies to hold this
access at all.

## Finding someone

```http
GET /api/v1/citizens?purpose=CRIMINAL_INVESTIGATION&name=...&caseRef=CASE-2026-00928
```

A search needs the case, and returns a thin projection: name, PCID, LGA, ward,
approximate age, status. Enough to confirm you have the right person.

It does not return an address, a phone number, a photograph or a date of birth.
If a search returned those, an officer could learn everything they wanted without
ever opening a record — and nothing would show that they had.

Searching is rate limited, and sustained volume raises a security alert for your
supervisor. The alert describes your account's activity, never the people you
searched for.

## Opening a record

Associate the person with your case first:

```http
POST /api/v1/cases/CASE-2026-00928/subjects
{
  "subjectType": "CITIZEN",
  "subjectId": "PL-4K7T9-QM2XB-7H",
  "subjectRole": "SUBJECT_OF_INTEREST",
  "justification": "Named by the complainant as the registered keeper of the vehicle involved."
}
```

The justification is recorded and read. Write what you would be content to read
back in a review: "named by the complainant as the registered keeper", not
"investigation".

Then:

```http
GET /api/v1/citizens/PL-4K7T9-QM2XB-7H?purpose=CRIMINAL_INVESTIGATION&caseRef=CASE-2026-00928
```

`restrictedFields` names what was withheld. Some fields need a supervisor's
approval; asking is the route, not working around it.

## Requesting a restricted field

```http
POST /api/v1/access-requests
{
  "purpose": "CRIMINAL_INVESTIGATION",
  "resourceType": "CITIZEN",
  "subjectPcid": "PL-...",
  "caseRef": "CASE-2026-00928",
  "requestedFields": ["citizen.lawEnforcementMarkers"],
  "justification": "Needed to establish whether an active public-safety marker exists."
}
```

If the field is already available to you, the platform says so and does not queue
a request — a rubber-stamp queue trains people to stop reading.

A supervisor decides. They can approve a subset, and every approval expires. You
cannot approve your own request, and neither the API nor the database will let
you try.

## Vehicles and property

```http
GET /api/v1/vehicles?purpose=CRIMINAL_INVESTIGATION&registrationNumber=PLT-123-ABC&caseRef=CASE-2026-00928
```

Returns vehicle identity, registration status and — if your agency holds the
law-enforcement compartment — stolen and wanted markers. The registered owner's
identity is released for investigative purposes; their **contact details are
approval-gated**, because a registered keeper is not a suspect.

Every response carries provenance and a `stale` flag. Check it before acting on an
alert: the record belongs to the transport authority and the platform holds a
synchronised copy.

## Missing persons

The missing-person and unidentified-person registers are their own authority —
they do not need a separate case number, because the record _is_ the case. They
are still bound by your role, your agency, your jurisdiction and the field
catalogue.

```http
POST /api/v1/missing-persons          { fullName, ageYears, distinguishingFeatures, lastSeen..., circumstances }
POST /api/v1/missing-persons/{ref}/matches/run
GET  /api/v1/missing-persons/{ref}
POST /api/v1/matches/{id}/review      { decision, note }     ← supervisor only
```

**A match is never an identification.** The engine returns candidates with every
contributing factor and its weight, and an explanation of why you are seeing it.
It compares age, apparent sex, where and when, and described features — nothing
else, and nothing derived from any protected characteristic.

Confirming a candidate is a separate act by a supervisor, recorded against them
by name. The database refuses a confirmed match with no reviewer, so there is no
path by which the system identifies anyone on its own.

The officer who ran the search cannot confirm the result. Take the question to a
supervisor with the factors in front of you.

## Break glass

For the case the model cannot anticipate: a person is in front of you, the
authority you need does not exist yet, and waiting causes harm.

```http
POST /api/v1/break-glass
{
  "resourceType": "CITIZEN",
  "subjectPcid": "PL-...",
  "incidentRef": "INC-2026-000123",
  "gates": ["INCIDENT_BINDING"],
  "reason": "Casualty is unresponsive at the scene and next of kin must be reached before transfer."
}
```

What it is:

- **temporary** — an hour at the outside, enforced by the database;
- **minimal** — one person, one record type, only the binding gates named;
- **logged** — supervisors are notified on first use;
- **reviewed** — within 24 hours, by someone other than you.

What it is not: a way to get a role you do not have, to exceed your clearance, or
to reach law-enforcement material your agency is not authorised for. None of
those can be relaxed by any grant.

Use it when it is warranted. Write a reason a reviewer can assess — "unresponsive
casualty, next of kin needed before transfer", not "urgent".

## For supervisors

Your daily work on this platform:

- **Approval queue** — `GET /api/v1/access-requests?forApproval=true`. Your own
  requests are not shown; approve the narrowest useful field set and set a short
  expiry.
- **Break-glass review** — `GET /api/v1/break-glass/review-queue`, flagging
  overdue. Mark each justified or unjustified with a note. This is the control
  that makes break glass acceptable; if the queue is not worked, it is not a
  control.
- **Case assignment** — you can take on a case in your own agency without being
  assigned first, because managing your caseload is administration and releases
  nothing. Data access still requires the assignment.
- **Match confirmation** — the decision the system will not make.

## What your agency cannot do

- Read a case it is not assigned to, even inside its own agency.
- Export the registry. No role holds an export action.
- Locate a person. The platform holds no such capability.
- Score or rank citizens. Nothing in it does that, and no query groups by any
  protected characteristic.
- Hide an access. Every one is recorded, and refusals are recorded as carefully as
  successes.

## What the citizen sees

A resident can see which agency accessed their record, when and for what purpose.
Access under an active criminal investigation is withheld from that view under a
stated legal basis, which the Data Protection Officer can review.

That is the bargain: you get the access you need for the case in front of you, and
it is accountable afterwards.
