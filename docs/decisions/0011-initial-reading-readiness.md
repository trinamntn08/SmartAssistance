# ADR-0011: Start pending translation when the reading panel is ready

- Status: Accepted
- Date: 2026-10-03
- Refines: ADR-0007 and ADR-0008 startup coordination

## Context

On first opening, a selected passage can reach the panel while the document is
hidden or its reading connection is still being established. The previous
visibility listener only synchronized the connection, without attempting the
pending translation. A local port reference also did not prove that the worker
had registered the reader. Users could need a language change to start translation.

## Decision

The worker sends the content-free `READING_READY` acknowledgement after validating
the panel connection and registering its reading client. The panel waits for that
acknowledgement before initial translation, queued language translation, or reading
polls. Only the currently connected port's exact acknowledgement is accepted;
unexpected messages and messages from disconnected ports are ignored.

On visibility changes, synchronize the reading connection and reconsider pending
translation. On readiness acknowledgement, reconsider it again. Existing consent,
loaded preferences, active capture/expiry, operation phase, and busy/one-shot
guards still apply. Consume automatic intent only when those gates permit a
request, using the saved target language or Vietnamese by default.

Hiding/closing the panel disconnects and removes readiness. Neither an already
attempted translation nor a failed/cancelled generation is automatically retried
by repeated acknowledgements, visibility events, or panel reopening. Existing
worker-side consent and active-tab checks remain authoritative.

## Validation

Test hidden initial capture becoming visible, delayed/current/stale readiness,
authenticated versus untrusted connections, duplicate startup events, default and
saved language startup, and no automatic retry on reopening. Browser fixtures
simulate sidebar visibility while using genuine extension ports and a local fake
rewrite API; actual native sidebar gestures remain a manual release check.

This changes internal startup ordering without changing capture scope, provider
requests, retention, Chrome permissions, or production dependencies.
