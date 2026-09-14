# Emergency response guide

For dispatchers, incident officers and field responders.

## The portal

`apps/emergency` is this guide made into an interface, at
`http://localhost:3400` in development. Two very different screens share it: the
board on a control-room wall, and a tablet in a vehicle.

Sign in with your work email address and the six-digit code from your
authenticator. If an administrator chose your passphrase you will be made to
replace it before anything opens.

The navigation is built from the entitlements your account actually holds, read
from the same list the policy engine reads. Control sees the board and
dispatching; a crew sees the person in front of them; a fleet office sees the
vehicles and nothing about any person at all. Each sees only what it can use.

Everything below is reachable from it. The HTTP is shown because integrators and
mobile clients need it, and because it is the honest description of what the
portal does on your behalf.

## How access works in an emergency

Your access is bound to an **incident**. Creating one opens access for the people
and agencies attached to it; closing it closes that access, with nothing separate
to remember.

That design is why a responder can identify an unresponsive casualty in seconds
without the platform being open to everyone all the time.

## Taking a call

```http
POST /api/v1/incidents
{
  "type": "ROAD_ACCIDENT",
  "severity": "CRITICAL",
  "description": "Multi-vehicle collision with casualties on the Zaria Road.",
  "addressText": "Zaria Road, Jos",
  "lgaCode": "PL-JNO",
  "wardCode": "PL-JNO-01",
  "latitude": 9.9,
  "longitude": 8.86
}
```

Returns `INC-2026-000123`. Everything from here refers to it.

Coordinates are recorded with **how they were obtained** — caller-supplied,
responder-observed, or from a government record — and with a retention date.
An incident location is an observation about an event. The platform holds no way
to locate a person, and nothing here creates one.

## The fleet

A unit is a vehicle and a crew. Registering one is administration, not access to
anybody's record — which is why a technical role that deliberately carries no
data entitlement at all can own the fleet:

```http
POST  /api/v1/response-units    { "unitCode": "AMB-JOS-01", "type": "AMBULANCE", ... }
PATCH /api/v1/response-units/AMB-JOS-01   { "status": "AVAILABLE" }
```

Status here is limited to `AVAILABLE` and `OFFLINE` — putting a unit into service
and taking it out. The operational statuses belong to the dispatch workflow,
which knows whether they are true; a fleet screen that could write them would let
somebody mark an ambulance available while it is carrying a patient. A unit out
on a job is stood down from the incident, not from the fleet.

There is no position field. Where a unit is, is something the unit says:

```http
POST /api/v1/response-units/AMB-JOS-01/position  { "latitude": 9.9, "longitude": 8.86 }
```

That is the only live position the platform holds, it is reported by the unit
about itself, and there is no citizen equivalent anywhere (§16, §64).

## Dispatching

```http
GET  /api/v1/response-units?nearIncident=INC-2026-000123
POST /api/v1/incidents/INC-2026-000123/dispatch   { "unitCode": "AMB-JOS-01" }
```

The first returns available units ordered by distance. Dispatching attaches the
unit's agency to the incident, which is what opens incident-bound access for the
crew attending.

As the job runs:

```http
PATCH /api/v1/dispatches/{id}   { "status": "ACKNOWLEDGED" }
                                { "status": "EN_ROUTE" }
                                { "status": "ON_SCENE" }
                                { "status": "COMPLETED" }
```

Each transition is validated — a completed dispatch cannot go back to en route —
and the timestamps produce the response-time measures without anyone recording
them by hand: call to dispatch, dispatch to arrival, total response, time to
resolution.

Marking `ON_SCENE` also moves the incident and stamps first arrival.

## Identifying a person at the scene

Scan the credential's QR or type the PCID:

```http
GET /api/v1/citizens/PL-4K7T9-QM2XB-7H/emergency-profile?incidentRef=INC-2026-000123
```

You receive the **Minimum Necessary Emergency Profile** and nothing else:

| Released                          | Why                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Name                              | To address them, and to find next of kin                                             |
| Approximate age                   | What clinical decisions need. Not the date of birth, which is an identity credential |
| Sex                               | Clinical relevance                                                                   |
| Photograph reference              | To confirm you have the right person                                                 |
| LGA                               | Where they are from                                                                  |
| Emergency contacts                | The people to call                                                                   |
| Blood group                       | Emergency care only                                                                  |
| Critical conditions and allergies | What the person chose to disclose for exactly this moment                            |

Not released: date of birth, address, phone number, email, NIN, tax or property
records, or anything about cases. If you need something outside this set, you need
a different authority — and in most emergencies you do not.

The PCID field tolerates how people actually type under pressure: lower case,
missing hyphens, a missing `PL` prefix, and the confusable characters. The format
excludes I, L, O and U precisely so this is possible, and a check pair catches a
mistyped identifier before a lookup happens.

## If you are not attached to the incident

You get nothing — and the refusal does not confirm the incident exists.

Ask control to attach you, which is the normal path and takes seconds:

```http
POST /api/v1/incidents/INC-2026-000123/officers
{ "userId": "…", "role": "RESPONDER" }
```

Your service is attached on its own as soon as one of its units is sent, so this
is for the individual case: a paramedic from another service, an incident officer
taking a handover, a commander joining a major incident.

Whoever does it must be on the incident themselves. Attaching somebody is the act
that opens the casualties' details to them, so an account that could attach
itself to any live incident would undo the control the incident exists to be.
A closed incident authorises nothing, so nobody can be added to one. If the
person is in front of you and waiting causes harm, use break glass:

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

Then pass `breakGlassRef` alongside `incidentRef`.

It lasts at most an hour, notifies supervisors immediately, and is reviewed within
24 hours by someone other than you. Write a reason a reviewer can assess.

Break glass cannot give you a role you do not have or exceed your clearance. It
stands in for the attachment you did not have time to get, and that is all.

## A person whose identity is unknown

```http
POST /api/v1/unidentified-persons?incidentRef=INC-2026-000123
{
  "condition": "UNCONSCIOUS",
  "estimatedAgeMin": 30, "estimatedAgeMax": 40,
  "apparentSex": "MALE",
  "distinguishingFeatures": "Scar above the left eyebrow, healed fracture of the right wrist.",
  "foundAddress": "Zaria Road, Jos",
  "foundLgaCode": "PL-JNO", "foundWardCode": "PL-JNO-01"
}
```

Record what you can actually observe. Distinguishing features carry the most
weight in matching against open missing-person reports — a scar, a healed
fracture, a tattoo — so describe them specifically.

The record enters the unidentified-person register, where a missing-persons
officer can run matching against open reports. The platform stores no biometric
data and performs no biometric matching; if your agency holds fingerprints or
similar under its own lawful authority, record the _reference_ to them.

## Attaching people to the incident

```http
POST /api/v1/incidents/INC-2026-000123/persons
{ "citizenPcid": "PL-...", "role": "CASUALTY" }
{ "unidentifiedPersonId": "...", "role": "CASUALTY" }
```

This is what records an identification, with who made it and when.

## Closing

```http
PATCH /api/v1/incidents/INC-2026-000123/status
{ "status": "RESOLVED", "note": "All casualties transported; scene cleared." }
{ "status": "CLOSED" }
```

Resolving it ends the access it authorised: a later attempt on somebody's
emergency profile says the incident is closed, which is the correct and useful
answer. Closing it afterwards is the last act.

The incident record itself stays readable to the people who were on it. That is
not an oversight — it is where an incident differs from a case file. A case file
lists its subjects by identifier with the reason each was linked, so closing a
case closes the file. An incident record names no citizen at all: it is what
happened, which units went, and how long each step took. A service that could not
read back a job it attended could not debrief it, answer a complaint about it, or
check the response times it is measured on.

## What control sees

```http
GET /api/v1/incidents?activeOnly=true
GET /api/v1/incidents/INC-2026-000123          → timeline, units, response times
GET /api/v1/analytics/incidents                → volumes, categories, response times
GET /api/v1/analytics/hotspots                 → wards with recurring demand
GET /api/v1/analytics/response-units           → performance by unit type and agency
```

Analytics are aggregates. Buckets below the suppression threshold are reported as
suppressed rather than as counts, because a count of one in a ward is a person.
Performance is grouped by unit type and agency, never by individual responder:
this measures service capacity, not people.

## The short version

1. Create the incident. It is the authority for everything after.
2. Dispatch the nearest available unit.
3. Identify the person from the credential, naming the incident.
4. You receive only what emergency care needs.
5. If you are not attached and cannot wait, break glass — and expect the review.
6. Record unknown persons factually and specifically.
7. Close the incident, which closes the access.
