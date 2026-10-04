# ADR-0006: Immediate context-menu translation

- Status: Accepted
- Date: 2026-10-03
- Refines: ADR-0005 invocation and transmission behavior

## Context

The user requests Vietnamese by default and translation directly from the
selection context menu, without another Translate click.

## Decision

Add Vietnamese to the language picker and use it when no valid translation
preference is saved. Keep explicit saved language preferences. The toolbar
continues to capture locally and requires Translate; choosing the translation
context menu records a one-shot automatic intent on the captured selection.
Target the context-menu frame explicitly so another frame's selection is not used.

The panel waits for initial preferences and versioned privacy consent before
starting that translation. Accepting consent starts a pending context-menu
translation without another click. Bump the notice version and disclose this
transmission behavior. The service worker still enforces consent and operation
boundaries; no provider policy, host permissions, or budgets change.

The worker removes automatic intent when a generation begins, before waiting for
the provider. It is valid only on a captured selection. Cancellation, failure,
panel reopening, and worker restart after generation must not retry automatically.
The existing snapshot/attempt matching excludes superseded results. The panel
shows no original text or Copy button and retains manual Translate for retry.

## Validation

Test default and saved language, early preference reads, consent gating and
acceptance, automatic invocation, frame targeting, one-shot consumption, failure
without retry, and Chromium workflows for consecutive automatic translations.
Live translation quality and actual native context-menu gestures remain manual
verification tasks.
