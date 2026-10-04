# Implementation status

Snapshot: 2026-10-04. The local MVP is implemented. Public release is not complete.
The [product brief](product/PROJECT_BRIEF.md) defines the target requirements;
the [architecture overview](architecture/README.md) describes the current code.

## Investigation record: 2026-10-04 Edge MSN capture error

- Outcome: traced the reported message to capture, before local translation.
  An isolated Edge profile captured a selected shadow-DOM paragraph on the
  reported public MSN article through the full current extension pipeline.
  The user's native invocation failure was not reproduced and is not fixed.
- Installation evidence: the ignored existing beta ZIP is version 0.1.1 but lacks
  selected-text capture and local reading. It also lacks the exact reported error;
  an outdated install remains a possibility, not a confirmed cause. Prepared an
  ignored current-build Edge test ZIP without changing production code or version.
- Validation: all 31 existing Chromium workflows passed using an ignored copy
  of the harness with the installed `msedge` channel and isolated profiles
  (`npx playwright test --config tmp/edge-test.config.ts`, 1.5 minutes). Providers
  were fake; no real models downloaded or translated, and no user profile changed.
  `npm run format`, `npm run format:check`, `npm run lint`, and
  `git diff --check` passed. Only documentation changed; the Chrome gate was not
  rerun after its prior successful validation.
- Follow-up: verify the installed folder/build and exact toolbar/context-menu
  invocation, then reproduce native sidebar selection behavior. Real Edge model
  availability and quality remain pending. Updated the Edge troubleshooting guide.

## Step record: 2026-10-04 documentation and unused-control cleanup

- Outcome: removed the retired Recapture markup, click handler, and its unused
  compact CSS. Capture through the toolbar remains supported. Unit and browser
  assertions cover panel startup without the control.
- Documentation: clarified reading-only setup without an API/key, read-only
  selection support, retained backend translation, and the existing Render beta
  blueprint. Replaced the completed local-translation implementation checklist
  with a current summary and remaining verification work. Kept relevant Edge
  investigation, ADRs, and historical status evidence.
- Validation: `npm run format` and full `npm run check` passed: formatting, lint,
  type checks, 272 unit tests, workspace builds, and 31 Chromium workflows.
  The final notice wording was rebuilt with `npm run build`; final
  `npm run format:check` and `git diff --check` passed. A relative-link audit
  passed for all 64 links in README and docs. The first link-audit invocation
  failed due to PowerShell argument quoting; the corrected stdin invocation passed.
- Follow-up: reload the unpacked extension. Native local-model quality, offline
  behavior, and device latency verification remain pending as documented.

## Step record: 2026-10-04 hide Recapture button

- Outcome: hid the side-panel Recapture button using the HTML hidden state.
  The extension icon remains available to capture text again. Updated the README
  and added a Chromium assertion that the button is hidden.
- Validation: `npm run format` passed. The initial `npm run check` passed format,
  lint, and type checks but was blocked at Vitest startup by sandbox `spawn EPERM`.
  Rerunning with subprocess access passed the full `npm run check`: formatting,
  lint, type checks, 271 unit tests, workspace builds, and all 31 Chromium workflows.
  `git diff --check` passed.
- Follow-up: reload the unpacked extension to see the updated panel.

## Step record: 2026-10-04 copyable reading selections

- Outcome: fixed reading capture rejecting visually selectable text marked with
  accessibility-only hidden/read-only/disabled attributes, or passages crossing
  hidden widgets and embedded form controls. Explicit reading now captures only
  the selected substring of ordinary inputs/textareas, including read-only fields.
  Sensitive-field checks follow shadow hosts. Writing restrictions and active
  reading's writing-field exclusions remain in place. No clipboard permission,
  dependency, cloud request, or Edge implementation was added.
- Validation: `npm run format` and the full `npm run check` passed: formatting,
  lint, type checks, 267 tests across 16 files, all workspace builds, and 31
  Chromium workflows. Four additional trust-boundary/length regression cases
  were then added; `npm test` passed all 271 tests and `npm run typecheck` passed.
  Final formatting, lint, and `git diff --check` passed. Synthetic Chromium
  selections omit hidden text and embedded field values; both new reading
  workflows translate locally with zero cloud requests. Test subprocesses used
  approved execution outside the restricted sandbox.
- Documentation: [ADR-0014](decisions/0014-copyable-reading-selections.md), the
  product brief, README, and privacy disclosure record the revised reading scope.
- Follow-up: reload the extension and refresh the affected page for real-site
  retesting. The affected website has not yet been identified or independently
  verified. Protected browser pages, PDF/canvas surfaces, and inaccessible frames
  remain unsupported. Edge support stays in the existing plan, deferred at the
  user's request. This record accompanies the fix commit; locate its hash with
  `git log --oneline -- apps/extension/src/selection.ts`.

## Step record: 2026-10-04 Edge investigation and plan

- Outcome: added the [Edge compatibility plan](edge-compatibility-plan.md).
  Shared-codebase desktop Edge support appears feasible; official support,
  native verification, packaging, and publication have not been implemented.
- Evidence: an isolated Windows Edge 154.0.4258.53 extension probe exposed
  sidePanel/open and both local AI APIs, with a chrome-extension origin. Detector
  and en->vi / fr->vi availability were unavailable in the headless profile.
  This does not establish that normal desktop Edge lacks those models.
- Validation: five existing synthetic browser workflows passed on Edge (15.8s):
  capture/preview/replace/undo for three editor types, changed-editor protection,
  and missing-local-API handling without cloud fallback. Temporary diagnostic
  copies/profiles remain ignored; no production code, user profile, model packs,
  remote provider, deployment settings, or store listing were changed.
- Follow-up: actual sidebar gestures/visibility, model downloads and Vietnamese
  pair availability, offline playback/translation, bilingual quality, latency,
  complete repeatable Edge coverage, and distribution/origin configuration.
- Documentation validation: `npm run format`, `npm run format:check`,
  `npm run lint`, and `git diff --check` passed. No runtime source changed;
  the full Chrome gate was not rerun. This record accompanies the planning
  commit; locate it with `git log --oneline -- docs/edge-compatibility-plan.md`.

## Step record: 2026-10-04 local reading integration and automated verification

- Outcome: reading uses the Chrome local adapter in the side panel, with separate
  local acknowledgement, explicit setup/retry, content-free worker authorization,
  and no cloud fallback. Grammar/writing retain their cloud route and consent.
  Active reading, saved language, pronunciation, and compact panel layout remain.
- Lifecycle: attempts belong to the authenticated panel document/port and current
  tab/capture/language; cancellation, teardown, expiry, tab switches, navigation,
  and consent withdrawal discard stale output. Tab changes clear empty-capture
  reading scope as well as pending/completed selection captures. Local output is
  kept only in panel memory. No permissions or dependencies were added.
- Review: corrected standard detector results containing an `und` uncertainty
  candidate and the empty-capture tab-scope edge; both have regression coverage.
  Follow-up read-only review found no remaining confirmed critical findings.
- Validation: `npm run format` and `npm run check` passed format, lint, workspace
  and test type checks, 260 Vitest tests across 16 files, all workspace builds,
  and 29 Chromium workflows. A test-only non-null-assertion warning was removed;
  the subsequent `npm run lint` passed without findings. Browser reading fixtures
  assert zero cloud requests and inject local APIs; writing regressions pass.
  The narrow reading layout screenshot was visually checked. `git diff --check`
  passed. Initial sandbox build/test subprocess restrictions were resolved by
  approved execution; they were not code failures.
- Artifacts: added 50 versioned synthetic quality cases and the
  [native verification guide](local-translation-verification.md), and updated
  setup, product, architecture, privacy, and integration-plan documentation.
- Release gates still open: stable Chrome native side-panel gestures and model
  downloads, actual offline reuse/playback, bilingual quality review, and measured
  warmed latency. These cannot be established by fake models or the headless probe.
  No paid quality comparison, release package, upload, or push was performed.
- Commit: this record accompanies the integration checkpoint; locate its hash
  with `git log --oneline -- docs/status.md`.

## Step record: 2026-10-04 local translation adapter

- Outcome: added the injected Chrome local translation adapter with safe errors,
  bounded setup/detection/translation, confidence checks, explicit Chinese
  mappings, instance reuse, cancellation, disposal, and late-object cleanup.
- Validation: scoped Biome formatting/lint passed; `npm test --
  apps/extension/src/local-translation.test.ts` passed all 30 tests. The initial
  sandbox test startup hit `spawn EPERM`; approved execution passed.
- Follow-up: panel/worker integration and real-model verification remain pending.

## Step record: 2026-10-04 local translation feasibility

- Outcome: added an isolated API probe and accepted
  [ADR-0013](decisions/0013-chrome-local-reading-translation.md) for implementation.
- Evidence: `node scripts/probe-local-translation.mjs` passed in headless
  Chromium 153.0.8010.12 on Windows. Both APIs were exposed and en->vi / fr->vi
  packs were downloadable; the detector was unavailable. No real translation,
  download, native panel test, latency measurement, or quality review completed.
- Adjustment: proceed with guarded implementation and deterministic tests under
  the user's implementation request; retain the real-model feasibility/quality
  checks as unresolved release gates rather than treating them as passed.
- Validation: probe passed. Formatting/lint/diff checks recorded in this commit.

## Step record: 2026-10-04 local translation planning

- Outcome: added the [Chrome local translation integration plan](local-translation-plan.md)
  with feasibility, provider adapter, lifecycle/privacy integration, and quality
  validation checkpoints. Implementation has not started.
- Proposed policy: local-only reading translation with explicit setup/retry;
  grammar and writing improvement retain the server provider. No automatic cloud
  fallback. Actual Chrome side-panel compatibility and bilingual quality remain
  to be verified in the planned steps.
- Validation: documentation-only change; `npm run format`, `npm run format:check`,
  `npm run lint`, and `git diff --check` passed. Runtime tests were not rerun
  because this step changes only documentation.
- Commit: this record accompanies the planning commit; locate it with
  `git log --oneline -- docs/local-translation-plan.md`.

## Step record: 2026-10-04 current-state snapshot

- Outcome: checkpoint the current reading translation, active-reading, local
  pronunciation, editor compatibility, extension assets, and release packaging
  work, including its product documentation and ADRs 0005–0012.
- Workflow: `AGENTS.md`, `CONTRIBUTING.md`, and the README now require a progress
  record and Git commit after each completed cohesive step, before the next step.
- Validation: `npm run format` passed with no changes. `npm run check` passed
  formatting, lint, workspace/test type checks, 212 Vitest tests across 15 files,
  all workspace builds, and 21 Chromium workflow tests. The initial sandbox run
  stopped at Vitest startup with `spawn EPERM`; the approved rerun passed.
  `git diff --check` passed, and the snapshot file list was reviewed for secrets
  and generated output. Local environment files and beta ZIPs remain ignored.
- Follow-up: automated tests use synthetic text and fake providers/speech.
  Live model quality, device voice playback, real-site behavior, and hosted
  release packaging remain separate verification tasks; public-release work
  listed below remains open.
- Commit: this record is included in the current-state snapshot commit; use
  `git log --oneline -- docs/status.md` to find its hash.

## Implemented

- Local reading translation through Chrome Translator and LanguageDetector,
  independent of the API/key and cloud-writing consent. Setup/retry guidance and
  deterministic failure states replace automatic paid fallback; see
  [ADR-0013](decisions/0013-chrome-local-reading-translation.md). Native model
  compatibility, quality, and latency remain unverified.

- Local pronunciation: one sound icon beside Original and Translation reads that
  area's selected text, or its full passage when nothing is selected. The same
  icon becomes Stop. Original language is detected locally by Chrome with a
  bounded deadline; translation uses the target language. Only local device voices
  are used; unsupported languages show a message without remote fallback. See
  [ADR-0010](decisions/0010-selection-sound-controls.md).

- Selected-page-text reading translation with a remembered target language and
  a panel displaying both original text and translation without Copy, Replace, or
  Undo; see [ADR-0005](decisions/0005-selected-text-translation.md) and its panel
  refinement in [ADR-0010](decisions/0010-selection-sound-controls.md).
- Chrome Manifest V3 extension invoked from toolbar, context menu, or shortcut.
- Complete-field capture for supported inputs, textareas, and basic
  contenteditable editors, with sensitive-field exclusions and formatting warning.
- Open shadow-root editors use host-aware availability checks and input events;
  managed-editor replacement and undo resolve focus through nested open shadow roots.
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

Later on 2026-10-03, missing-voice messages gained language-specific installation
guidance and a Windows speech-settings link; see
[ADR-0012](decisions/0012-missing-voice-installation-guidance.md). A new sound click
queries available voices again; successful playback and capture cleanup hide the
guidance. `npm run format` and `npm run check` passed: formatting, lint, type checks,
212 Vitest tests across 15 files, all workspace builds, and 21 Chromium workflows.
OS settings launch, actual voice downloads, and Chrome's exposure of installed
voices require manual verification. The extension does not install OS packages.

Later on 2026-10-03, first-opening translation now waits for the authenticated
reading connection and resumes when the panel becomes visible, using the default
or saved language without a dropdown change; see
[ADR-0011](decisions/0011-initial-reading-readiness.md). Existing consent and
one-attempt rules remain in place. Spoken selections keep their native highlight
after playback finishes or stops, until another click or leaving the panel.
Replacing the selected text clears it; a translation arriving preserves an
unchanged Original selection. `npm run format` and `npm run check` passed:
formatting, lint, all type checks, 211 Vitest tests across 15 files, all workspace
builds, and 21 Chromium workflows. Coverage includes delayed/current connection
acknowledgement, first reveal with default and saved languages, no automatic
retry after failure, and selection retention and clearing. The selected-text
screenshot was visually checked. Browser workflows simulate panel visibility
and speech; native sidebar opening and audible device voices remain manual checks.

Later on 2026-10-03, the reading layout was compacted to 14px text and Original
was collapsed by default. Its keyboard-accessible heading toggle expands/collapses
the text; generation updates preserve expansion and new captures reset it.
Writing mode continues to show its original directly. `npm run format` and
`npm run check` passed: formatting, lint, all type checks, 202 Vitest tests across
15 files, all workspace builds, and 19 Chromium workflows. Coverage includes
collapse defaults, expansion retention/reset, source-selection and speech cleanup
on collapse, keyboard toggling, viewport fit, and 14px computed text sizes.
Collapsed and expanded screenshots at 320 by 600 and the 400 by 800 layout were
visually checked. Translation uses the freed space and text areas scroll internally.

Later on 2026-10-03, pronunciation was simplified to selectable Original and
Translation text areas with one sound/stop icon each; see
[ADR-0010](decisions/0010-selection-sound-controls.md), which supersedes ADR-0009.
`npm run format` and the final `npm run check` passed: formatting, lint, all
workspace/test type checks, 200 Vitest tests across 15 files, all workspace builds,
and 19 Chromium workflows. Coverage includes selected/full text playback on both
icons, keyboard activation, selection preserved after icon focus, local source
language detection, detection timeout/unknown language, superseded detection,
playback switching/cancellation, lifecycle/consent/expiry cleanup, generic detected
language voice matching, and oversized-passage errors. Screenshots at 400 by 800
and 320 by 600 were visually checked; both text areas scroll internally and the
panel fits the viewport. Browser speech and source-language detection are faked in
the workflow tests: audible output, real installed voices, and actual detection
quality still need manual Chrome verification. No permissions, dependencies,
microphone access, remote speech service, or additional model/API calls were added.

On 2026-10-03, local pronunciation was added; see
[ADR-0009](decisions/0009-local-pronunciation.md). `npm run format` and the final
`npm run check` passed: formatting, lint, all workspace/test type checks,
193 Vitest tests across 15 files, all workspace builds, and 19 Chromium workflow
tests. Coverage includes local-only language matching, missing and late-loading
voices, word segmentation, safe text rendering, keyboard navigation/activation,
source-language selection without another API call, cancellation, stale callbacks,
errors, timeout, consent withdrawal, capture expiry, and panel hide/close.
Screenshots at 400 by 800 and 320 by 600 were visually checked, including long
translations and expanded original-selection controls. Browser speech is faked:
audible playback, installed local voices, and language quality need manual Chrome
verification. No microphone, new permission/dependency, or remote speech service
was added. Existing unrelated working-tree changes were preserved.

On 2026-10-03, active reading was added: a visible, consented panel translates
new settled selections on the invoked page and stops when hidden or closed;
see [ADR-0008](decisions/0008-active-reading.md). `npm run format` and
`npm run check` passed: formatting, lint, type checks, 173 Vitest tests across
14 files, all workspace builds, and 18 Chromium workflow tests. Coverage includes
panel lifecycle, consent, tab-switch races, duplicate selections, pointer release,
and writing-field exclusions. The browser fixture simulates sidebar visibility;
native Chrome sidebar gestures and live provider quality remain manual checks.

On 2026-10-03 the Translate button was removed from reading mode. Opening a
selection and changing the target language now request translation after consent;
see [ADR-0007](decisions/0007-language-change-translation.md). `npm run check`
passed with 158 Vitest tests, all builds, and 17 Chromium tests. A CSS selector
ordering warning was corrected and `npm run format` / `npm run lint` then passed
without warnings. Coverage includes coalescing rapid language changes, discarding
obsolete results, saved preferences, consent, button visibility, and expanded
result layout. The resulting panel screenshot was visually checked.

The translation result layout was then expanded to fill the available sidebar
height, with compact controls on one row and internal scrolling for long text.
`npm run format` and the final `npm run check` passed: formatting, lint, type
checks, 156 Vitest tests, all builds, and 17 Chromium workflow tests. The added
layout test verifies long output at 400×800 and 320×600 without page scrolling;
screenshots at both sizes were visually checked.

Later on 2026-10-03, Vietnamese was added as the default translation language
and the selection context menu was changed to translate immediately after
consent; see [ADR-0006](decisions/0006-immediate-context-menu-translation.md).
The final `npm run check` passed: formatting, lint, type checks, 156 Vitest tests
across 13 files, all workspace builds, and 16 Chromium workflow tests. Coverage
includes saved preferences, early consent acceptance, context-frame targeting,
consecutive immediate translations, and no automatic retry on panel reopening
or failure. The local API health check also returned `status: ok`; it does not
establish live provider quality. Native context-menu gestures on real websites
still require manual verification.

On 2026-10-03, after adding selected-text translation, `npm run format` and
`npm run check` passed locally: formatting, lint, workspace/test type checks,
150 Vitest tests across 13 files, all workspace builds, and 15 Chromium workflow
tests. The translation panel was visually checked at 400px width. A read-only
review identified a saved-language initialization race; it was fixed and covered
for both early capture and an intervening user language choice before the final
gate. Tests use synthetic text and fake providers; real-site toolbar/right-click
gestures and live translation quality remain unverified.

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
