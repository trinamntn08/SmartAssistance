# ADR-0013: Chrome local reading translation

- Status: Accepted for implementation; real-model release verification pending
- Date: 2026-10-04
- Refines: ADR-0001, ADR-0005, ADR-0008, ADR-0011

## Decision

Use Chrome's Translator and LanguageDetector APIs for selection reading translation
in the extension side panel document, behind an injected local provider adapter.
The service worker remains authoritative for capture scope, consent, current tab,
expiry, and generation identity. Content-free begin/complete messages authorize
local attempts; results remain in panel memory and never travel to the API.
Reject the previous extension selection-to-cloud route. Keep grammar and writing
improvement on the existing server adapter; retain backend translation capability.

Local reading has a separate versioned acknowledgement describing device processing
and Chrome-managed model downloads. It does not require endpoint-scoped cloud
consent or an API key. There is no automatic cloud fallback. Missing APIs, failed
setup, uncertain detection, and unsupported pairs show safe messages and explicit
retry/setup controls. New setup requiring user activation happens from an in-panel
button; automatic invocation cannot be assumed to carry a document gesture.

Feature-detect APIs and language-pair availability. Keep minimum Chrome 116 for
writing compatibility; describe local translation as requiring Chrome 138+ and
available device models. Preserve Chinese scripts through explicit mappings only.
Use provisional detection confidence >= 0.8 with a >= 0.2 margin over the next
candidate; these are conservative guardrails, not calibrated quality guarantees.
Short/mixed passages may need a longer selection. Source equals target returns
the original locally.

Keep the existing input/output and capture-expiry bounds. Bound detection waits to
5 seconds, translation to 15 seconds, and each model setup wait to 120 seconds.
Cancel and discard obsolete attempts; destroy local objects on panel teardown.
Use one detector and at most one translator pair in memory. Cancellation may stop
the extension's wait without reversing Chrome's model download. Do not add history,
remote scripts, host permissions, production dependencies, or raw-text logging.

## Feasibility evidence and remaining gates

`node scripts/probe-local-translation.mjs` passed on Windows in an isolated
headless Chromium 153.0.8010.12 extension document. Translator and LanguageDetector
were exposed; en->vi and fr->vi reported downloadable. Detector availability was
unavailable. No language models were downloaded and no real translation ran.
The script does not open a user's profile or send text to a cloud translator.

This establishes API exposure, not stable Chrome native-side-panel compatibility
or translation quality. Proceed with deterministic integration under the user's
implementation request; keep model downloads, native gestures, warmed/offline
translations, device measurements, and bilingual review pending before release.
Tests must prove no remote reading requests and preserve writing workflows.

Sources:
[Translator](https://developer.chrome.com/docs/ai/translator-api),
[Language Detector](https://developer.chrome.com/docs/ai/language-detection).

## Consequences

Reading can avoid paid requests and uploading selected text. First-use downloads
and device/browser restrictions introduce setup work; unsupported devices receive
an error rather than a silent paid fallback. Local quality and latency vary by
pair and device. Browser fake-provider tests cannot establish those properties.
