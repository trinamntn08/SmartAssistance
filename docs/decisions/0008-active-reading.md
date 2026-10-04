# ADR-0008: Active reading scoped to a visible panel and invoked tab

- Status: Accepted
- Date: 2026-10-03
- Refines: ADR-0007 selected-text invocation

## Decision

The user explicitly requests automatic translation of new selections while the
extension panel is open. The consented, visible panel holds an authenticated
runtime port and polls settled selections every 700ms. Hidden or closed panels
disconnect and stop polling. The worker requires at least one valid sidepanel
connection plus current endpoint consent before asking for text. The last reader
disconnect cancels a pending selection translation, without automatic retry.

Poll only documents injected during the explicit invocation and only while that
tab is active. Navigation/closure invalidate this scope; there is no grant for
another page or new host permission. Worker restart can recover the unexpired
captured document as a bounded fallback, not an arbitrary tab. New valid text
reuses snapshot identity, expiry, auto-generation, and existing cancellation.
Do not persist a selection history or return page text to the panel poll caller.

Content events record pointer state and selection-change timing, not text.
Reading requests wait 350ms after selection changes and pointer release before
capture. Duplicate selected text does not request another translation. Keep only
selection identity metadata to prevent polling the same selection from renewing
an expired capture. Recheck the active tab after capture and before provider
submission. Exclude
writing fields in active reading, preserving explicit writing and translation
invocation behavior. Initial empty capture still records injected documents, so
the user can select their first passage after opening the panel.

## Validation and limits

Test consent and connected-panel gates, untrusted connection rejection, tab scope,
debounce and pointer release, writing-field exclusions, duplicate suppression,
disconnect cancellation, and browser new-selection/hidden/closed workflows.
The browser fixture uses an extension tab with simulated sidebar visibility;
actual sidebar lifecycle gestures still need manual verification. Panel closure
cancels waiting but cannot retract already submitted provider text.
