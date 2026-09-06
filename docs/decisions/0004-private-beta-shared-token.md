# ADR-0004: Bounded private beta with a shared extension token

- Status: Accepted
- Date: 2026-09-06
- Scope: Small, time-limited friend-and-family testing only

## Context

The local MVP has no account, token-issuance, refresh, or per-user quota flow.
The owner wants to test with a small private Chrome Web Store audience before
investing in that product infrastructure. The API must remain production
configured so the OpenAI key never enters the browser.

## Decision

The private-beta extension build may embed `SMARTASSISTANCE_BETA_API_TOKEN` and
send it as a bearer token only when no future user-specific session token is
available. Render stores the same value only as the server-side
`SMARTASSISTANCE_API_TOKEN` secret. The beta build also embeds the public HTTPS
API URL and only that origin is granted extension host permission.

The API is deployed as one HTTPS Render service with a production origin
allowlist, a provider timeout, a five-request-per-minute process-wide limit,
one concurrent rewrite, and a 1,024-token output cap. The Chrome Web Store item
is private and distributed only to named testers.

## Consequences

- Positive: The OpenAI key remains server-only; the beta can be installed and
  exercised by a small tester group without user accounts.
- Positive: Rotating the server token and rebuilding the extension immediately
  revokes the previous beta build's access.
- Negative: A tester can inspect and share the shared bearer token. Chrome Web
  Store private distribution is an installation control, not API authentication.
- Negative: Limits are global to one API process and do not identify or fairly
  allocate usage between testers.
- Risk: The free hosting service can sleep while idle and does not provide a
  production availability guarantee.

This ADR expires when invitation-based authentication and durable per-user
quota accounting are implemented. Do not treat this configuration as a public
release authorization design.
