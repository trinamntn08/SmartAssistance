# ADR-0015: Resolve rendered selections inside open shadow roots

- Status: Accepted
- Date: 2026-10-04
- Refines: ADR-0014

## Context

An MSN headline remained visibly selected in Edge while capture reported empty.
An isolated Edge mouse-drag fixture reproduces this with nested open shadow roots:
the document Selection has rendered text but isCollapsed is true and its range is
retargeted to BODY. Programmatically adding a range does not reproduce this.

## Decision

Keep Selection.toString() as the only page-text payload. Resolve validation ranges
with feature-detected getComposedRanges and accessible open shadow roots. On older
Chromium, use a noncollapsed root-scoped selection when available. Walk sensitive,
unavailable, form-field, and active-reading contenteditable ancestry across hosts.
Do not treat the document's collapsed flag alone as proof of an empty selection.

Reject ranges whose endpoints are in different trees, and collapsed document
selections whose composed range only exposes the surrounding document/closed host.
These cannot be safely validated by the current capture implementation. Do not
read host textContent, surrounding text, clipboard contents, or context-menu text
as a fallback. No permissions, capture history, provider, or expiry changes.
Reconcile non-whitespace payload characters against the inspected selected visible
text nodes. This rejects additional rendered text from opaque descendants, even
when the document selection itself is noncollapsed. The captured output remains
the original rendered selection string; reconciliation never supplies a payload.
Unverifiable CSS text transformations may be rejected rather than bypassing this
check.

## Validation and limits

Use mouse-drag Chromium and Edge fixtures, not only addRange tests. Verify exact
selected-substring capture and local translation with zero cloud calls, plus
sensitive shadow-host rejection. Unit tests cover composed and legacy selection
APIs, closed-host rejection, and writing-field exclusions across hosts.
This resolves the reproduced capture failure, not Edge model availability or
real-model translation quality. Native user retesting remains required.

Reference: [Selection API](https://www.w3.org/TR/selection-api/#dom-selection-getcomposedranges).
