# ADR-0003: Native plain-text insertion for managed editors

- Status: Accepted
- Date: 2026-09-06
- Refines: ADR-0002 contenteditable replacement and undo

## Context

Local testing reported successful Gmail replacement but no visible replacement
in Facebook and Messenger. The generic adapter replaces DOM children and emits
synthetic events; a framework can keep separate editor state and reject those
changes. This is a compatibility hypothesis, not a verified diagnosis of the
user's live pages.

## Decision

For contenteditable roots with a `data-lexical-editor` attribute or Draft-style
`data-contents="true"` descendants, select only the captured root's contents and
use Chrome's `execCommand("insertText")` with plain text. Keep the existing
adapter for ordinary editors. No page-internal framework objects, clipboard,
additional permissions, or simulated Send actions are used.

This deprecated browser API is deliberately confined to this compatibility path;
synthetic input events alone do not perform browser editing. Check editor identity,
availability, text, and markup before mutation, including after focus handlers.
Wait one event-loop turn for queued reconciliation and verify the resulting text
before reporting success. Refuse failed insertion without forcibly replacing DOM
children. A failure asks the user to inspect the field because a page may have
partially handled the edit. Later asynchronous page changes remain possible.

Undo on this path reinserts the original plain text through the same mechanism;
it does not restore rich formatting or framework-owned nodes. Original-node undo
remains unchanged for the generic adapter. Snapshot expiry and stale-draft checks
remain in force.

## Validation and limits

Chromium fixtures check native input events, multiline replacement, plain-text
markup handling, undo, and a page that rejects an edit during reconciliation.
These synthetic fixtures are not actual Lexical/Draft implementations and do not
establish Facebook or Messenger compatibility. Real-site retesting is required.
