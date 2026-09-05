# Implementation status

Snapshot: 2026-09-05. The local MVP is implemented. Public release is not complete.
The [product brief](product/PROJECT_BRIEF.md) defines the target requirements;
the [architecture overview](architecture/README.md) describes the current code.

## Implemented

- Chrome Manifest V3 extension invoked from toolbar, context menu, or shortcut.
- Complete-field capture for supported inputs, textareas, and basic
  contenteditable editors, with sensitive-field exclusions and formatting warning.
- Rephrase, grammar, concise, and translate operations; natural, formal, and
  casual tones; explicit target-language selection.
- First-use endpoint-scoped consent, preview, copy, retry, cancellation, explicit
  replacement, and one-level undo.
- Snapshot/document/attempt identity, changed-editor checks, navigation and tab
  cleanup, and ten-minute capture expiry.
- Stateless Node.js API, shared validated contracts, versioned rewrite policy,
  and a server-side OpenAI adapter with deadlines and no automatic retries.
- Process-wide rate and concurrency limits, temporary bearer-token gate, origin
  restrictions, and operational logs without draft or rewrite bodies.
- Unit/integration tests, Chromium workflow tests, CI configuration, and a
  20-case synthetic evaluation corpus with an opt-in live runner.

## Verification

On 2026-09-05, `npm run format` completed without changes and `npm run check`
passed locally using Node.js 24.20.0:

| Check | Result |
| --- | --- |
| Formatting and lint | Passed |
| Workspace and test type checking | Passed |
| Vitest unit/integration tests | 104 passed across 11 files |
| Contracts, API, and extension builds | Passed |
| Chromium workflow tests | 9 passed |

The initial shell used unsupported Node.js 18.16.0; validation was rerun with
Node 24. The sandbox also blocked a required test subprocess (`spawn EPERM`);
the successful gate ran with approved execution outside that sandbox.
These are local results, not a claim that remote CI has run. Automated tests use
synthetic text and fake providers; they do not establish live model quality or
production readiness. Live provider evaluations and manual website checks were
not run for this snapshot.

## Remaining before public release

1. Select and implement user authentication, extension login, token issuance and
   refresh. The existing session-token forwarding hook is not a login flow.
2. Implement shared per-user quotas and usage accounting. Current limits apply
   to one API process and cannot enforce quotas across replicas.
3. Run live synthetic evaluations and human review; measure semantic quality,
   protected facts, latency, and cost against the brief. No such results are
   established by this snapshot.
4. Verify toolbar/context-menu/shortcut permissions on real Chrome websites,
   editor compatibility, keyboard and screen-reader behavior, and RTL handling.
   UI localization and a WCAG 2.2 AA audit remain open.
5. Prepare hosted infrastructure, TLS, secrets, monitoring, provider retention
   and residency settings, and content-safe operational log retention.
6. Prepare and validate Chrome Web Store packaging and release materials.

Rich formatting preservation, Google Docs/canvas editors, cross-origin frames,
site-specific integrations, other browser packages, billing, and persistent
history remain outside the initial scope. The optional detected-language
response field is not populated by the current provider adapter.
