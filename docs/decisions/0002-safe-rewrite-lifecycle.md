# ADR-0002: Bound rewrite identity, retention, and provider execution

- Status: Accepted
- Date: 2026-09-05
- Owners: Repository owner
- Refines: ADR-0001 snapshot comparison and validation mechanisms

## Context

A model response can outlive the editor capture that requested it. A snapshot
check at replacement alone cannot detect a preview accidentally associated with
another capture. Nonempty model output can also be an incomplete response.
The local prototype needs enforceable interaction and execution limits before
testing with sensitive drafts.

## Decision

Keep the extension/API/provider topology. Maintain one active interaction across
extension panels, with a tab ID, top-level Chrome document ID, random snapshot ID,
absolute expiry, generation attempt ID, and explicit phase:

```text
captured -> generating -> preview -> applied
    ^            |                    |
    +------------+--------------------+
           failure/cancel/undo
```

Recapture, navigation, source-tab closure, clearing, or expiry invalidate the
interaction. Serialize worker state transitions, but keep provider waits outside
that serialization. Every result is matched to its originating attempt before
publishing it. UI response delivery does not depend on the relative arrival order
of Chrome storage events and runtime replies. The worker remains authoritative
for replacement and undo; DOM access targets the captured document explicitly.

Compare captured text directly, and contenteditable markup when applicable,
instead of relying on a small noncryptographic hash. Recheck availability and
sensitive-field exclusion at capture and mutation. Restore original DOM nodes
only while they remain detached and unchanged. Formatting preservation for new
rewrites remains outside scope; explicit whitespace rendering preserves paragraphs.

Captures expire ten minutes after capture. Store the current draft only in Chrome
session storage, previews in panel memory, and undo data in the content script.
Use an alarm for MV3 cleanup and absolute expiry checks before use. Browser
suspension can delay physical cleanup; no expired draft may be reused. Remove
incompatible stored state. Add the `alarms` permission only for this lifecycle.

Require versioned first-use consent, scoped to the API endpoint, in the worker
before transmission. Store only that preference in local storage. Public API
endpoints require HTTPS; HTTP is restricted to loopback extension builds.

The API accepts only JSON rewrite requests, rejects unapproved browser origins,
has an 18-second total deadline, and propagates disconnect cancellation. The
provider adapter uses at most 15 seconds, no automatic retries, configurable
bounded output tokens, no tools, and `store: false`. Accept only completed,
nonempty, non-refusal output. The extension transport expires after 20 seconds.
Cancellation is best effort at the provider and cannot reverse completed work.

Keep operation instructions in a versioned product-policy module independent of
SDK transport. Record model, prompt version, provider request ID, token counts,
duration, operation, and status without text. Disable SDK logging to prevent
environment-controlled debug logging of prompts.

Use a process-wide request budget and concurrency cap for the local slice.
Do not treat these as per-user or distributed quotas. Production identity and
shared usage accounting still require a separate decision before hosted beta.

## Validation and consequences

Add deterministic API, message-boundary, editor, and asynchronous UI tests, plus
Chromium workflow tests. Playwright is a development-only dependency justified
by DOM rendering and Chrome-extension lifecycle behavior that JSDOM cannot prove.
Browser fixtures receive access only to their local test website; manual checks
still verify real user gestures and website compatibility.

Maintain a synthetic evaluation corpus and an opt-in bounded live runner.
Deterministic protected-fact checks do not establish semantic correctness or the
human preference release threshold. Model and token-budget choices must be
measured on the corpus before release; no automatic fallback provider is added.
On failure the editor remains unchanged and any prior successful preview remains
available to copy until the interaction is invalidated.

Avoid persistence of drafts for metrics or evaluations. Provider retention is a
deployment property documented separately in `docs/privacy.md`.
