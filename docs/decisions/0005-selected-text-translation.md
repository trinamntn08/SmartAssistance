# ADR-0005: Read-only selected-text translation

- Status: Accepted
- Date: 2026-10-03
- Refines: ADR-0001 capture scope and ADR-0002 interaction lifecycle

## Context

Reading translation requires explicit selections outside writing fields. The
user wants a simple panel without repeating selected text or offering Copy.

## Decision

Reuse the side panel, stateless API, provider adapter, consent, bounds, deadlines,
and temporary interaction identity. Add a versioned `translate` operation that
requires an explicit target language and forbids writing tone settings.

The toolbar tries selected visible DOM text before complete-editor capture;
the selection context menu requests translation and the writing context menu
and existing shortcut retain complete-editor capture. Empty selections permit
toolbar fallback; rejected selections never fall back to sending an entire field.
Do not expand host permissions or monitor selections in the background.

Selection interactions carry `source: selection`; editor interactions retain
their existing state shape. Selection capture has no mutation or undo snapshot.
The worker rejects editor mutations for selections and writing operations on
selection captures. Selected text follows the same ten-minute session-storage
expiry and navigation/recapture cleanup as drafts; output stays in panel memory.

The translation panel shows the target language, Translate, and plain translated
text. It hides original text, writing mode, Copy, Replace, and Undo. Cancellation
remains available while waiting. Remember only the target-language preference
locally. Bump consent version to disclose the added selected-text capture scope.
Invocation captures locally; only Translate sends selected text to the API.

## Validation and limits

Test partial selection capture, exclusion and length limits, contract validation,
consent enforcement, operation separation, mutation refusal, language persistence,
panel controls, and a Chromium translation workflow alongside existing writing
tests. Synthetic evaluations include explicit translation cases; live semantic
quality and toolbar/right-click gestures on real sites still need manual review.

This slice supports injectable webpage DOM selections, not whole-page translation,
browser PDF viewers, canvas editors, inaccessible frames, or protected Chrome pages.
