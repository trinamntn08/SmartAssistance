# Edge compatibility investigation and plan

Date: 2026-10-04
Status: investigation complete; official Edge support and packaging not implemented.

## Conclusion

The existing extension is a good candidate for desktop Microsoft Edge without a
separate application or source fork. Microsoft documents Chrome extension API
compatibility and `chrome.sidePanel`. Our current build loaded in an isolated Edge
profile, and five selected synthetic browser workflows passed.

Full local-reading support remains conditional on real model availability and
native sidebar verification. API exposure alone does not establish usable models,
Vietnamese support on a given device, translation quality, or offline behavior.
The product brief still excludes Edge packaging; this investigation does not
declare Edge supported or change that scope.

## Evidence

### Official documentation

- [Porting Chrome extensions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension):
  check supported APIs and sideload to test before publishing. Our manifest has
  no `update_url`, and its name/description contain no Chrome branding.
- [Supported extension APIs](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support):
  our MV3 runtime uses action, alarms, commands, contextMenus, i18n, runtime,
  scripting, sidePanel, storage, and tabs. Verify the methods we use, not just
  namespace presence.
- [Sidebar API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar):
  Edge uses `chrome.sidePanel`, the `sidePanel` permission, and `side_panel`
  manifest key. Microsoft documents a tab-return sidebar visibility issue;
  native lifecycle tests are required for our active-reading privacy boundary.
- [Translator API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/translator-api)
  and [Language Detector API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/languagedetector-api):
  Microsoft documents device-local models for websites/extensions with the same
  availability/create/translate/detect/destroy API shape our adapter expects.
  Model availability must be checked at runtime, independently for each pair.

Sources checked on the date above. Edge's ordinary webpage translation UI does
not establish extension-local Translator availability or privacy behavior.

### Local investigation

Installed Windows Edge executable reports version 154.0.4258.53. An isolated
headless persistent profile loaded a diagnostic MV3 extension with sidebar
permission; no user profile or settings were changed and no models downloaded.

| Probe | Observed result |
| --- | --- |
| `chrome.sidePanel` / `.open` | Present |
| Extension origin | `chrome-extension://<id>` |
| `Translator` / `LanguageDetector` | Both present |
| Detector availability | `unavailable` |
| English -> Vietnamese | `unavailable` |
| French -> Vietnamese | `unavailable` |

The probe was an ignored temporary copy of `scripts/probe-local-translation.mjs`
using Playwright's `msedge` channel and adding sidebar API/origin diagnostics.
Headless unavailability is not evidence that the same pairs are unavailable in
normal desktop Edge. Resolve it before promising local reading support.

Five existing workflows were copied to an ignored temporary test directory and
run on `msedge` with the existing synthetic page/fake API harness:

- capture/consent/preview/replace/undo for textarea, input, and contenteditable;
- refusal to replace changed editor content while keeping a copyable preview;
- missing local API produces an error without a cloud fallback.

All five passed (15.8 seconds). The missing-API case intentionally removes an API;
it is a guard test, not a real-model test. Regular extension tabs simulate sidebar
visibility and activeTab access is granted to the local fixture. These tests do
not prove toolbar/context-menu permissions, real sidebar gestures, site-specific
compatibility, audible speech, live provider quality, or installed model behavior.

## Implementation checkpoints

### 1. Native Edge feasibility and go/no-go

Load `apps/extension/dist` through `edge://extensions` with Developer mode and
Load unpacked. Record version, OS/device, and policy restrictions. Use synthetic
English/French passages, not private drafts.

Check toolbar, selection/editable context menus, Alt+Shift+R, actual sidebar open/
hide/close, port disconnect/readiness, navigation, and switching away/back. Capture
must remain restricted to the invoked page and stop when the sidebar is hidden.
Check the APIs from the sidebar document, including user activation, fresh/warmed
setup, en->vi and fr->vi availability, download/cancel behavior, and offline use
after successful setup. Do not enable experimental browser flags for a supported
release or substitute built-in full-page translation for our local adapter.

Exit: record supported features and exact blockers. If models remain unavailable,
retain explicit local unavailability with no cloud fallback. Decide whether to
offer writing-only Edge support as a separate product decision; do not silently
change the selected-text workflow to cloud processing.

### 2. Minimal compatibility changes and ADR

Write an Edge-support ADR refining ADRs 0001, 0008, and 0013 from native findings,
then update the product brief's browser scope and declared support matrix.
Keep a single codebase and shared manifest wherever feasible. Verify the current
minimum-version key in Edge; do not invent an undocumented Edge-specific key.
Use feature detection for models/sidebar capabilities. Adjust browser-specific
messages such as "Chrome is downloading" to match Edge or use neutral wording.
Keep local-only voices: Edge can expose voices that are not local and must not be
selected as a fallback. Verify `chrome.i18n.detectLanguage` used for source speech.

Exit: only demonstrated compatibility fixes, with Chrome behavior preserved and
no new host permissions, dependencies, remote model scripts, or cloud fallback.

### 3. Repeatable Edge validation

Make the diagnostics and browser harness accept a validated browser target
(`chromium` / `msedge`) while keeping the existing Chrome gate reproducible.
Use separate profiles/output directories and an installed Edge runtime.
Run the full writing/reading lifecycle suite with fake providers on both browsers.
Add Edge-specific sidebar and availability regressions where native findings
justify them. Repeat the existing 50-case local translation corpus on actual Edge
models with bilingual review; measure warmed p50/p95 separately from downloads.
Verify Chinese script handling, uncertain detection, expired gestures, absent
models, cancellation, zero reading API requests, and local voice installation help.

Exit: `npm run format` / `npm run check` pass, Edge workflows pass, and native
evidence identifies verified devices/pairs plus unresolved limitations. Do not
report fake-model results as translation-quality evidence.

### 4. Distribution and hosted access

For personal testing, reuse the unpacked build first. Decide later between an
existing Chrome Web Store item installed in Edge and a separate Microsoft Edge
Add-ons listing; validate the chosen installation/update path. Add-ons publication
and any dashboard/backend configuration changes are separate authorized work.
If the listing assigns a different extension ID, allow its exact observed
`chrome-extension://<id>` origin in the production API alongside the Chrome ID;
never use a wildcard. Preserve credentials on the server and current beta limits.
Only introduce a separate package if the tested store/manifest requirements need
it. Update privacy disclosures, setup instructions, screenshots, and release
checks from the verified Edge behavior.

Exit: reproducible package/install/update verification and accurate listing.
Do not publish before native lifecycle, model availability, and quality gates pass.

Record and commit each completed checkpoint in `docs/status.md`, with commands,
results, remaining risks, and commit hash reference, before starting the next.

Sideloading reference:
[Microsoft instructions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).
