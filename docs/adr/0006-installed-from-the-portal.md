# ADR 0006: The mobile applications are the portals, installed

**Status:** Accepted

## Context

Three people need this platform away from a desk: a resident in a queue, an
officer at a mobile registration point, and — the one that decides the shape of
the answer — a responder at a roadside, who may have to know whether the casualty
in front of them is diabetic while standing in a valley with no signal.

The default answer is a native application per platform, written in React Native
or Flutter and distributed through Google Play and the App Store. It is what most
teams reach for, and it buys real things: device attestation, background
execution, biometric unlock, and a storage layer the operating system encrypts.

It also costs real things, and for a state identity platform the costs land in
unusual places. Every fix reaches the people who need it only after a review by a
company in another jurisdiction, and then only when each person updates. A
resident on a metered connection pays for thirty to sixty megabytes before they
see their own identifier. The state acquires a dependency on two corporate
accounts it does not control, for an application its residents are obliged to use.
And the platform acquires a second surface on which authorisation has to be got
right.

A third option exists and was rejected early: a native shell with no offline
capability at all, which pays the distribution cost and buys nothing the browser
could not do.

## Decision

The citizen and responder applications are the existing portals, installable to a
home screen: a web application manifest, an icon set, and a service worker that
caches the shell. There is no second codebase and no store listing.

The government and security portals are responsive and are not installable, and
hold nothing offline at all. A registration desk without a network cannot
register anybody — the duplicate check, the identifier allocation and the audit
record all happen on the platform — and a case file read on a phone is read
online like any other. Installing them would add a service worker and a cache to
two surfaces with nothing to gain from either.

What a device may hold is bounded by the platform and set out in
[mobile.md](../mobile.md): a resident's own identifier, or the people already
attached to one live incident the responder is already attached to. Sealed in the
browser under a non-extractable key, expiring in hours, released to a registered
device, and revocable in one act.

## Costs accepted

**No device attestation.** A native application can ask the operating system to
vouch that it has not been tampered with. A web application cannot, so the
platform cannot tell a rooted phone from an ordinary one. The compensation is
structural rather than cryptographic: a device registration authenticates nothing,
an offline bundle carries no authority to fetch anything, and every decision is
still made and recorded on the server. An attacker with a rooted phone and a
live session has what that session already had.

**No background execution.** Nothing runs when the application is closed. For this
platform that costs little, because the one thing a responder application might
want to do in the background — report position — is done by the unit's own
device on a schedule the crew controls, and the platform holds no citizen
position at all (§16).

**Weaker at-rest protection than a native keystore.** The key lives in the
browser's storage rather than a hardware-backed keystore. It is non-extractable,
which defeats reading the storage off the device, and it does not defeat somebody
using the phone while it is unlocked. This is why the expiry is four hours and the
content is minimal, rather than why those are belt-and-braces.

**Push notifications do not reach older iPhones.** Web push needs iOS 16.4. Those
residents get the SMS notice the platform already sends, which carries the same
content — a notice and never the detail — by design.

**A weaker end-to-end test.** Playwright can take the network away from a page but
not from a service worker, so the fallback that serves the offline page when a
navigation fails is asserted at both ends rather than driven. A manual check in
aeroplane mode belongs in the pilot's acceptance.

## What would change the answer

A responder application that had to work with the screen off, capture photographs
with hardware-backed provenance, or run for days with no connection at all. If the
state later wants store distribution for reasons of reach rather than capability,
the work is a native shell around the same API — and the platform's half of the
offline mode, which is the half that carries the risk, transfers unchanged.
