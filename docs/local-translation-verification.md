# Local translation verification

Status: automated integration implemented; real-model release verification pending.
See [ADR-0013](decisions/0013-chrome-local-reading-translation.md).

## Try the extension

1. Use current stable desktop Chrome (138+), run `npm run dev:extension`, and
   reload `apps/extension/dist` in `chrome://extensions`. Refresh the source page.
   An API process or OpenAI key is not required for reading.
2. Select a synthetic English/French paragraph on a normal webpage and invoke
   Translate with SmartAssistance. Accept the separate **Enable local reading**
   notice. This does not enable cloud writing.
3. If prompted, click **Enable local translation** inside the panel. Chrome may
   download the detector and language packs. If detection finishes after the
   gesture expires, click again to prepare the translation pair. The progress
   message stays **Translating...** throughout setup and translation; Cancel stops
   the extension's wait, but the browser
   may continue its own download.
4. Once ready, new selections and target-language changes translate automatically.
   Errors offer **Retry local translation**. If unavailable, update Chrome/check
   device policy and try again; no text is sent to a paid fallback.
5. Verify Original expansion, sound controls, keyboard use, and language memory.
   Select a longer passage when language detection is uncertain.
   The extension also checks its built-in local language detector once when the
   model's result is uncertain; both detectors retain strict confidence checks.

## Native browser and privacy checks

Record browser version, OS/device, date, pair, pack state, and outcome. Verify
fresh setup and warmed reopening separately; do not reset the user's Chrome
profile or uninstall their model packs to simulate a clean device.

- Stop the backend and translate en->vi / fr->vi after setup.
- In extension DevTools, confirm no `/v1/rewrites` requests during reading.
  Model download network traffic is distinct from selected-text transmission.
- After packs are ready, disable the network and repeat synthetic translations.
- Change language/selection while translating, cancel, hide/close the panel,
  navigate, change tabs, clear consent, and wait for capture expiry. Old output
  must never reappear. Returning to a different tab requires a new invocation.
- Verify unsupported pairs, absent APIs, setup without activation, download
  failure, and missing local voice guidance without remote fallback.
- Capture a writing field: Generate remains disabled until separate cloud consent.
  Test preview/replace/undo with the existing fake API browser fixtures.
- Confirm model objects are recreated after teardown, and no selected/output text
  is persisted in local/synced storage. Chrome session storage retains only the
  bounded current capture and lifecycle metadata, not translated output.

## Quality and latency release gates

Use [the versioned synthetic corpus](evaluations/local-translation-cases.json).
Its 50 cases include English/French passages, short/ambiguous/mixed passages,
fact preservation, idioms, and instruction-like content. Longer passages should
translate; ambiguous cases may legitimately return the documented detection
error and should be reported separately as coverage failures.

For each applicable case, a bilingual reviewer records accept/reject and whether
meaning, negation, conditions, tone, names, numbers, URLs, and paragraph boundaries
were preserved. Review expectations are meaning constraints, not exact-output
matches. No output from a real user's page should enter evaluation artifacts.
Do not make paid comparison calls as part of normal translation; a separate
bounded cloud comparison must have explicit evaluation authorization and budget.

Report at least 99% protected-fact preservation on applicable deterministic checks,
85% bilingual acceptance on translation cases, unsupported/detection failure
rate, and any critical meaning errors. Do not describe unavailable/untested pairs
as verified or enable pairs with known failing quality by default.

Measure first-use setup separately from warmed detection, translation, and
end-to-end time for the same corpus and reference device. Report p50/p95 and
passage sizes. Initial warmed end-to-end p95 target is under 2 seconds for up to
2,000 characters; no such measurement has been established yet.

## Automated and diagnostic commands

```powershell
npm run format
npm run check
node scripts/probe-local-translation.mjs
```

The probe uses an isolated headless extension document, makes availability checks
only, and does not touch your profile or download packs. It cannot replace native
Chrome setup, offline, pronunciation, latency, or bilingual verification.

On 2026-10-04 it exposed both APIs on Windows Chromium 153.0.8010.12; en->vi and
fr->vi were downloadable, but the detector was unavailable. Actual translation,
native stable-Chrome setup, quality, and latency remain unverified. Automated
browser tests inject fake local models, including an `und` detector candidate.
