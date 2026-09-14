# ADR 0005: The citizen portal holds the session; the browser holds nothing

**Status:** Accepted

## Context

Residents need a way to see their own record, show their identity, manage their
emergency contacts and read who in government has opened their file. That means a
web application, and a web application needs a way to call an API that expects a
bearer token.

The default pattern is a single-page application: the browser signs in, receives
an access token and a refresh token, keeps them in memory or in storage, and
attaches the access token to every request. It is well understood and it is what
most teams reach for.

It is also the wrong shape for this. The token minted for a resident opens their
whole record — their address, their phone number, their emergency contacts, their
access history. Put that token in the browser and every cross-site scripting bug
anywhere in the portal becomes theft of a citizen's identity record, and the theft
is silent: an exfiltrated refresh token keeps working long after the tab is
closed. "We will not have an XSS bug" is not a control.

The alternative cost is real too. Server rendering means a round trip for
interactions a single-page application would handle locally, and it means the
portal is a process to run and scale rather than files on a CDN.

## Decision

The portal is a back-end-for-front-end. It renders on the server, and it holds
the session.

- Sign-in happens in a Server Action. The tokens the API returns never leave the
  portal process.
- The session — access token, refresh token, expiry, display name, and the two
  flags that say whether a second factor is still owed and whether the
  desk-issued passphrase still has to be replaced — is sealed with AES-256-GCM
  under a key only the portal holds, and set as an `HttpOnly`, `SameSite=Strict`,
  `Secure` cookie.
- Every page is a Server Component that calls the API server-side, refreshing the
  access token transparently when it is close to expiring.
- Mutations are Server Actions, which Next rejects when the submission's origin is
  not the portal's own. That, with the same-site cookie, is the CSRF defence.
- The portal holds no database credential, no token-signing key, and no
  entitlement of its own. It is a client of the platform and is authorised exactly
  as the resident signed into it is.

## Consequences

**Good.** There is no token in the browser to steal, and an end-to-end test
asserts on every page that no JWS and no bearer header appears in the HTML.
Revocation is immediate in both directions: signing out ends the session at the
API, and the API ending a session makes the cookie worthless on the next request.
The pages work with JavaScript disabled, on an old phone, over a bad connection —
which for this audience is the normal case. And because the portal only ever sees
what the policy engine released, it cannot accidentally display a field the
platform withheld: it has no copy of the record to fall back on.

**Costs, accepted.** Every interaction is a round trip; the portal is a stateful
process to deploy, monitor and scale alongside the API; and the session key is a
third secret to manage and rotate. Rotating it signs everyone out, which is
survivable but not free. A future offline-capable mobile application cannot reuse
this shape and will need the controlled, device-bound, expiring credential
described in §56 instead — a different design for a different threat model, not
an extension of this one.

**Rejected alternative: a single-page application with tokens in memory only.**
Memory-only storage narrows the window but does not close it; an injected script
runs in the same memory. It also loses the no-JavaScript path entirely.
