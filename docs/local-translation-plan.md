# Chrome local translation integration plan

Date: 2026-10-04
Status: Proposed; implementation has not started.

## Outcome and scope

Translate selected reading passages on the device using Chrome's `Translator`
and `LanguageDetector` APIs. Prioritize English and French to Vietnamese,
then verify other supported language pairs. Preserve the current reading panel,
saved target language, active reading, and pronunciation controls.

Proposed first-version policy: reading translation uses only the local provider.
Unavailable APIs, unsupported pairs, failed downloads, or uncertain source-language
detection produce a clear message and an explicit retry/setup action. No automatic
cloud fallback or paid request. Grammar correction and writing improvement retain
their existing server provider. A user-selected cloud fallback is separate scope.

This is a plan, not evidence of browser compatibility, speed, or translation quality.

## Constraints confirmed from documentation

- Chrome documents Translator support from Chrome 138 on desktop, including
  Vietnamese, English, and French. Detect API and pair availability at runtime;
  the current extension minimum is Chrome 116, so older installations need a
  helpful unavailable message while writing continues to work.
- Language packs download on demand. Creation requires user activation, which
  must be tested inside the actual extension side panel; a toolbar gesture or
  runtime message must not be assumed to transfer activation into that document.
- Translator is unavailable in Web Workers. Execute it in the extension side
  panel document, behind a small adapter, rather than in the service worker or
  the webpage content script.
- Translation runs locally after setup. Downloads require network access;
  demonstrate offline operation only after the required models are ready.

Sources, checked 2026-10-04:
[Translator API](https://developer.chrome.com/docs/ai/translator-api),
[Language Detector API](https://developer.chrome.com/docs/ai/language-detection),
[built-in AI requirements](https://developer.chrome.com/docs/ai/get-started),
[AI in extensions](https://developer.chrome.com/docs/extensions/ai).

## Implementation steps and commit checkpoints

### 1. Verify feasibility in real Chrome and settle the ADR

- Build a minimal extension-document probe for API presence, detector creation,
  pair availability, model downloads, and one synthetic translation. Check the
  actual side panel on stable Chrome, with fresh and already downloaded packs.
- Verify user activation, offline behavior, cancellation/destroy semantics, and
  availability after reopening the panel. Record Chrome version and device.
- Establish which pairs and scripts can be enabled, including Chinese variants.
  Do not map unsupported regional/script tags to a different language silently.
- Write ADR-0013 refining ADRs 0001, 0005, 0008, and 0011: local reading provider,
  document execution, worker authority, consent separation, and failure policy.

Exit: demonstrated side-panel translation for English/French to Vietnamese,
or a documented compatibility blocker before production implementation.
Commit the feasibility evidence and decision separately.

### 2. Add the local provider adapter

- Add `apps/extension/src/local-translation.ts` and adjacent tests, with an
  injected browser platform and typed states for unavailable, setup required,
  downloading, ready, translating, cancelled, and failed.
- Define a minimal provider interface independent of DOM and Chrome storage.
  Accept text, target language, and cancellation; return validated plain text
  and detected source language. Keep browser error details and text out of logs.
- Use local detection with an explicit confidence/ambiguity rule chosen from
  feasibility results. Short and mixed-language passages must not be silently
  treated as reliable detection; offer concise guidance when uncertain.
- Preserve existing 10,000-character input and 20,000-character output bounds.
  Reject empty or excessive output. If detected source equals target, return the
  original without a translation model call.
- Proposed initial deadlines: 5 seconds for ready-model detection, 15 seconds for
  translation, and 120 seconds for setup/download waiting. Use typed constants;
  tune from measurements and document any change. No automatic retry loop.
- Reuse a bounded number of detector/translator instances while the panel is
  visible; destroy them on teardown. Cancel superseded operations and ignore
  late callbacks. If browser downloads cannot be aborted, distinguish stopping
  the extension's wait from cancelling Chrome's download.

Exit: deterministic tests cover availability, activation errors, download failure,
timeouts, cancellation, language handling, and result validation. Commit.

### 3. Integrate reading lifecycle and privacy controls

- Route selection translation through the local adapter in `sidepanel.ts`.
  Show a compact "Enable local translation" action when initialization needs
  an in-panel gesture, plus accessible download progress and retry messages.
- Once ready, retain automatic initial translation, language changes, and settled
  selections. Preserve Vietnamese default and the Original/Translation layout.
- Keep capture scope, tab/document checks, ten-minute expiry, and generation
  identity authoritative in `service-worker.ts`. Add explicit validated local
  begin/complete/cancel messages in `messages.ts`; validate senders, current
  snapshot, visible reader, target language, and current attempt at each boundary.
  Keep translated output in panel memory, not session storage.
- Separate local-reading acknowledgement from endpoint-scoped cloud-writing
  consent. Reading must work without an API key, server connection, or cloud
  consent. Existing cloud consent must not silently grant local setup consent.
- Reject the old selection-to-cloud route in the extension. Retain the backend
  translation capability for now; removing it is outside this integration.
- Cancel/clear on selection or language change, hide/close, navigation, source-tab
  switch/closure, expiry, or consent withdrawal. Late output cannot restore text.
  Pronunciation must stop when its text becomes invalid.
- No new host permissions, external scripts, persistent text cache, or server
  translation requests. Chrome manages the language packs.

Exit: local reading works with the backend offline; writing retains its existing
workflow. Tests prove no translation fetch and no bypass of lifecycle checks.
Commit the integrated behavior with updated product/privacy/architecture docs.

### 4. Validate quality, latency, and release readiness

- Add fake-provider browser workflows for first-use setup, warmed startup,
  unsupported pairs, language changes, active reading, retries, cancellation,
  stale results, and local/cloud consent separation. Retain writing regressions.
- Verify actual native Chrome panel gestures, model downloads, offline reuse,
  playback, and keyboard/screen-reader status messages manually.
- Version 50-100 synthetic passages spanning short selections, ordinary prose,
  idioms, negation, names/numbers/URLs, paragraph breaks, and mixed languages.
  Obtain bilingual review against the existing provider; comparison calls are
  an explicit, bounded evaluation rather than part of normal translation.
- Record first-use setup separately from warmed latency. Measure detector,
  translator, and end-to-end time, reporting p50/p95 with device and passage size.
  Initial target: warm end-to-end p95 below 2 seconds for passages up to 2,000
  characters on the recorded reference device; this is a target, not a promise.
- Retain the brief's quality gates: at least 99% protected-fact preservation
  across applicable deterministic checks and 85% bilingual acceptance. Report
  critical meaning errors separately; do not enable failing pairs by default.
- Run `npm run format` and `npm run check`, review the diff, and update README,
  development guide, privacy notice, product brief, architecture, and status.

Exit: publish measured results and enabled-pair decisions. If manual or quality
checks are outstanding, mark release readiness incomplete. Commit the evidence;
package/upload only as a separately authorized release step.

## Completion records

For every completed step, update `docs/status.md` with outcome, commands and
results, manual evidence, remaining risks, and its commit checkpoint before
starting the next step. Never mark proposed tasks or unrun checks complete.
