# Implementation status

Snapshot: 2026-09-06. The local MVP is implemented. Public release is not complete.
The [product brief](product/PROJECT_BRIEF.md) defines the target requirements;
the [architecture overview](architecture/README.md) describes the current code.

## Implemented

- Chrome Manifest V3 extension invoked from toolbar, context menu, or shortcut.
- Complete-field capture for supported inputs, textareas, and basic
  contenteditable editors, with sensitive-field exclusions and formatting warning.
- Native plain-text replacement and undo for managed contenteditable editors
  with Lexical/Draft markers; see [ADR-0003](decisions/0003-managed-editor-native-insertion.md).
- Fix grammar and Improve writing modes; Natural or Formal style for Improve
  writing; explicit target-language selection.
- First-use endpoint-scoped consent, preview, copy, retry, cancellation, explicit
  replacement, and one-level undo.
- Snapshot/document/attempt identity, changed-editor checks, navigation and tab
  cleanup, and ten-minute capture expiry.
- Stateless Node.js API, shared validated contracts, versioned rewrite policy,
  and a server-side OpenAI adapter with deadlines and no automatic retries.
- Process-wide rate and concurrency limits, temporary bearer-token gate, origin
  restrictions, and operational logs without draft or rewrite bodies.
- Render blueprint and documented shared-token private-beta workflow; see
  [ADR-0004](decisions/0004-private-beta-shared-token.md). It still requires
  account configuration and Chrome Web Store review before any tester can use it.
- Unit/integration tests, Chromium workflow tests, CI configuration, and a
  20-case synthetic evaluation corpus with an opt-in live runner.

## Verification

On 2026-09-06, after the writing-mode simplification and Node.js 24.19.0
runtime update, `npm run check` passed locally:

| Check | Result |
| --- | --- |
| Formatting and lint | Passed |
| Workspace and test type checking | Passed |
| Vitest unit/integration tests | 106 passed across 11 files |
| Contracts, API, and extension builds | Passed |
| Chromium workflow tests | 11 passed |

The initial shell used unsupported Node.js 18.16.0; validation was rerun with
Node 24. The sandbox also blocked a required test subprocess (`spawn EPERM`);
the successful gate ran with approved execution outside that sandbox.
These are local results, not a claim that remote CI has run. Automated tests use
synthetic text and fake providers; they do not establish live model quality or
production readiness. The two added browser tests cover native input with
replacement/undo and an editor that restores its original state after insertion.
They use synthetic fixtures, not actual Lexical/Draft implementations.

### Manual verification reported on 2026-09-06

| Site | Evidence |
| --- | --- |
| Gmail | User reported Replace working before the managed-editor change. |
| Facebook / Messenger | User reported the retest working after the managed-editor change. |
| Local extension/API | User reported Improve writing with Natural style working after the Node 24 API restart. |

These are user-reported results from the tested fields, not an independently
observed compatibility audit. Exact browser versions and composer variants were
not recorded. Real-site Undo, formatting, mentions, attachments, and subsequent
typing/submission were not individually confirmed. Do not infer support for
every composer on these sites.

A short synthetic Improve writing request also succeeded through the local API
after its Node 24 restart. This is a connectivity smoke test, not the versioned
quality evaluation or human review required for release.

## Remaining before public release

1. Select and implement user authentication, extension login, token issuance and
   refresh. The existing session-token forwarding hook is not a login flow.
2. Implement shared per-user quotas and usage accounting. Current limits apply
   to one API process and cannot enforce quotas across replicas.
3. Run live synthetic evaluations and human review; measure semantic quality,
   protected facts, latency, and cost against the brief. No such results are
   established by this snapshot.
4. Extend the manual checks above to toolbar/context-menu/shortcut permissions on real Chrome websites,
   editor compatibility, keyboard and screen-reader behavior, and RTL handling.
   UI localization and a WCAG 2.2 AA audit remain open.
5. Prepare hosted infrastructure, TLS, secrets, monitoring, provider retention
   and residency settings, and content-safe operational log retention.
6. Prepare and validate Chrome Web Store packaging and release materials.

Rich formatting preservation, Google Docs/canvas editors, cross-origin frames,
further site-specific integrations, other browser packages, billing, and persistent
history remain outside the initial scope. The managed-editor compatibility path
is documented in ADR-0003. The optional detected-language
response field is not populated by the current provider adapter.
