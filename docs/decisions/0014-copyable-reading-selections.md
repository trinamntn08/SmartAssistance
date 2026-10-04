# ADR-0014: Capture copyable rendered reading selections

- Status: Accepted
- Date: 2026-10-04
- Refines: ADR-0005 and ADR-0008

## Context

Sites may mark visible text as `aria-hidden` or `aria-readonly`, or embed hidden
widgets and form controls within selected passages. Rejecting every intersecting
element blocks text the user can select and copy. The user requests translation
of those selections, including ordinary read-only text fields.

## Decision

Use Chromium's rendered `Selection.toString()` as the page-text payload, rather
than DOM `textContent` or `Range.toString()`. Validate selected visible text nodes
and their ancestors; hidden descendants and embedded form controls contribute no
text to Chromium's rendered selection and do not veto the passage. Accessibility
attributes alone do not indicate visual unavailability or a sensitive field.

For explicit invocation, a focused ordinary text input or textarea with nonempty
selection offsets yields only that substring, including read-only fields. Walk
ancestors across shadow hosts for sensitive/unavailable checks. Password and other
unsupported input types, payment/password/one-time-code autocomplete markers,
hidden, inert, and disabled fields remain excluded. Writing capture and automatic
reading's writing-field exclusion are unchanged. No clipboard access, new host
permission, cloud fallback, whole-field fallback, or mutation snapshot is added.
The existing 10,000-character cap and capture expiry apply.

## Validation and limits

Unit tests cover visible accessibility attributes, field substrings, sensitive
exclusions, and bounds. Chromium workflows verify that hidden text and embedded
field values are omitted while the visible passage translates locally, and that
explicit read-only field translation does not enable writing replacement.
The jsdom hidden-descendant fixture supplies Chromium's rendered selection string;
the real browser test is the evidence for that rendering behavior.

This does not add capture for protected browser pages, PDF/canvas surfaces, or
inaccessible frames. Actual affected-site retesting remains necessary.
