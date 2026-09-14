# The mobile applications

Three people need this platform away from a desk: a resident in a queue, an
officer at a mobile registration point, and a responder at a roadside. This is
what they get, why it is built the way it is, and what a device is allowed to
keep when the network is not there.

## The decision: installed from the portal, not from a store

The citizen and responder applications are the portals themselves, installable to
a home screen. There is no separate codebase, no app store listing and no release
train of their own.

That is a considered choice and the alternative was real: a React Native or
Flutter application distributed through Google Play and the App Store. Set against
each other for **this** platform, for **this** state:

|                                                           | Installed from the portal    | Distributed through the stores                  |
| --------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| Time from a fix to the people who need it                 | A deploy                     | A deploy, then review, then each person updates |
| Cost to a resident on a metered connection                | The page they already loaded | 30-60 MB, before they see anything              |
| Who can withhold it                                       | Nobody                       | Two companies, at their discretion              |
| Authorisation model                                       | The platform's, unchanged    | A second surface to get right                   |
| Offline capability                                        | Yes, bounded (below)         | Yes, unbounded unless bounded                   |
| Device attestation, background location, biometric unlock | No                           | Yes                                             |

The last row is the honest cost, and two of the three are things this platform
deliberately does not want. It holds no citizen location and never will (§16), so
background location is not a capability it is missing. Biometric unlock is a
convenience the browser will acquire through passkeys.

Device attestation is a genuine loss: a native application can ask the operating
system to vouch that it has not been tampered with, and a web application cannot.
What the platform does instead is refuse to depend on the client being honest. A
device registration authenticates nothing on its own, an offline bundle carries
no authority to fetch anything, and every decision is still made and recorded on
the server. An attacker with a rooted phone and a signed-in session has what that
session already had; they do not gain a way to ask for more.

The rows above the last are the ones a state should weigh hardest. A platform the
state cannot update without a foreign company's review, and which costs a
resident data they may not have to install, is a platform with a queue at the
counter.

**What would change the answer.** A responder application that had to work with
the screen off, take a photograph with hardware-backed provenance, or operate for
days without any connection would need to be native. If the state later wants
store distribution, the work is a native shell around the same API, and §56 below
is the part that would carry over unchanged — it is the platform's half.

## What each application is

| Application           | Who                        | Where it runs                   | What it holds offline                     |
| --------------------- | -------------------------- | ------------------------------- | ----------------------------------------- |
| Plateau ID            | Residents                  | `apps/portal`, installed        | The Plateau Citizen ID and the name on it |
| PCID Response         | Emergency crews            | `apps/emergency`, installed     | The people attached to one live incident  |
| The government portal | Counter and field officers | `apps/government`, in a browser | **Nothing**                               |

The third row is deliberate. A registration desk, mobile or not, has a network or
it cannot register anybody: the duplicate check, the identifier allocation and
the audit record all happen on the platform, and a queue of applications held on a
tablet to be uploaded later is exactly the "copy of the registry on a device" that
§56 forbids. The government portal is responsive and works on a phone; it is not
installable and it keeps nothing. The security agency portal is the same, for the
same reason: a case file is read online, under a decision made at the moment of
reading.

Installing a portal is not free — it puts a service worker and a cache alongside a
surface that holds citizen data — so it is done only where there is something to
gain from it.

## The controlled offline mode (§56)

§56 asks for six properties. Any five without the sixth is a data breach waiting
for a lost phone, so each one is named here with the place a reader can check it.

**Encrypted.** The bundle is sealed in the browser with AES-GCM under a key
generated as `extractable: false`. WebCrypto will use that key and has no
operation that returns it, so an image of the device's storage, a phone backup, or
another application reading the profile directory all get ciphertext.
[`packages/portal-kit/src/offline/store.ts`](../packages/portal-kit/src/offline/store.ts).

Be exact about what that is worth. It does **not** protect against somebody using
the phone while it is unlocked — nothing in a browser can. It protects against
the storage being read off the device, which is the realistic loss: a phone sold,
stolen, backed up to a laptop, or handed to a repair shop. The other five
properties are what cover the rest.

**Expiring.** Four hours for an incident pack — long enough for the job in front
of the crew, short enough that a tablet left in a vehicle overnight holds nothing
by morning. A day for a resident's own identifier. The ceiling is enforced three
times: in the contract, in the service, and by a `CHECK` constraint on
`offline_release` that refuses a row lasting more than a day. The client enforces
it too, and that is not belt-and-braces — the platform is the thing that is
unreachable when the expiry matters, so a client that trusted the server to time
it out would hold an expired pack for as long as it stayed offline.

**Device-bound.** A bundle is released to a registered device and recorded against
it. The device presents a secret issued once at registration; the platform stores
only its hash. That secret **authenticates nothing** — it travels with an ordinary
authenticated session and says only which registered device that session is being
used from. This is why it can live in the browser at all, and why the portals'
central property is intact: an API token still never reaches the browser.

**Minimal.** An incident pack contains the people already attached to the
incident, and a responder cannot name them — "take this person offline" is not an
operation, so the register cannot be walked one profile at a time. Each person in
it is produced by the ordinary emergency-profile path, one at a time, each
authorised by the policy engine and each written to the audit trail. A bundle
therefore cannot contain anything its holder could not have read on screen. A
resident's card is two fields.

**Revocable.** Signing a device out revokes the sessions opened on it, refuses it
anything further, and marks every release it held invalid — in one act, because
reporting a phone lost should not be two things that can be done by halves. The
device erases its copy the moment it reaches a network. Until then it holds
ciphertext that expires on its own, which is precisely why the bundle is
short-lived and minimal rather than merely revocable.

**Never a copy of the registry.** There is no path that returns people not already
linked to an incident; a pack larger than fifty people is refused rather than
truncated, because a crew cannot tell a shortened list of casualties from a
complete one; and the platform stores the _shape_ of every release — which device,
how many people, expiring when — and never its contents, which would put the same
personal data in a second place under a second retention rule.

Held by [`services/api/test/integration/offline.test.ts`](../services/api/test/integration/offline.test.ts)
for the five the platform decides, and by the portals' `offline.spec.ts` suites
for the sixth: those read the sealed record straight out of IndexedDB and check
that it is ciphertext and that the key beside it reports `extractable: false`.

One link in the chain is asserted rather than driven, and it is worth naming.
Playwright can take the network away from a page but not from a service worker,
so a test cannot make a real navigation fail and watch the fallback fire. What
the suites check instead is each end of that link: the "no signal" document is in
the device's cache and is the right document, and the pack renders from the
device's own storage with nothing asked of the platform. The four lines of the
worker between them are read, not run. A manual check on a phone in aeroplane
mode is what closes it, and belongs in the pilot's acceptance.

### What the service worker may cache

The shell, and nothing else: the stylesheet, the icons, the build assets, and one
"no signal" page. It never caches an authenticated response.

That restraint is the whole design. A portal page holds exactly the information
this platform spends its effort deciding who may see, and the browser's HTTP cache
is neither encrypted, nor bounded in time, nor revocable — it is the opposite of
every property §56 asks for. The rule is enforced by only ever _putting_ a
response in the cache when the request was for one of the allowed paths, rather
than by inspecting headers, which is the kind of check that quietly stops
matching. Both e2e suites assert that no page about a person is in the cache
after a full journey.

## Signing in, on a phone

Unchanged, and worth saying because a mobile application is where platforms
usually weaken it. The same passphrase, the same authenticator, the same
short-lived session. There is no "remember me on this device" that skips the
second factor, and registering a device does not create one: a device is a place
that may hold something, never a way to prove who you are.

## What is not built

- **Native applications.** Set out above, with what would change the answer.
- **Push notifications on iOS below 16.4.** The platform's push channel works
  through the web push protocol, which older iPhones do not support. Those
  residents get the SMS notice the notification templates already send — which is
  the same notice, by design, since an outbound message never carries the detail.
- **Offline capture.** Nothing is recorded offline, in either application: no
  queued registration, no queued unit status, no queued "person found". A crew
  with no signal reads; it does not write. An emergency record that was written
  into a phone and lost with it is worse than one written late, and a queue of
  unsent writes is a second, unaudited source of truth.
- **A field-officer application.** The government portal is responsive and holds
  nothing offline, for the reasons in the table above. If the state wants
  registration at a market or a village meeting, the missing piece is not an
  application: it is connectivity, and a satellite terminal or a bonded modem is
  the answer to it.
