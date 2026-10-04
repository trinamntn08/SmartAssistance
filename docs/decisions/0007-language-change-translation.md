# ADR-0007: Translation from invocation and language changes

- Status: Accepted
- Date: 2026-10-03
- Refines: ADR-0006 translation controls and toolbar behavior

## Context and decision

The user wants the language dropdown to request translation without a Translate
button. Hide that button in reading mode and keep Generate for writing. Toolbar
selection capture, like the context menu, records a one-shot automatic intent.
After preferences and consent load, opening the selected passage translates it
into Vietnamese or the explicit saved language. Changing the dropdown requests
translation of that same selection. Update the versioned privacy disclosure.

Keep provider calls serialized within the panel. If languages change during a
request, discard its response and queue only the latest language for the same
snapshot. Start it once the current request settles and worker state permits
generation. Recapture discards that queue; Cancel discards pending language intent.
Keep worker identity, consent, expiry, mutation rejection, budgets and timeouts.
Neither failure nor reopening an already-attempted interaction retries automatically.
Users can change language or recapture to request translation again.

## Validation

Test change-triggered requests, rapid changes coalesced into the last language,
discarding obsolete output, consent, default and saved settings, reload without
retry, full-height result layout, and unchanged writing workflows. Normal tests
use fake providers and synthetic content.
