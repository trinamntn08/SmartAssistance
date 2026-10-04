# SmartAssistance

SmartAssistance is a privacy-first Chrome writing assistant that fixes grammar
or improves the complete text in a focused email, comment, or message field,
and helps people understand, pronounce, and write another language by translating
selected page text and playing pronunciation on request.

To translate while reading, select visible text, right-click, and choose
**Translate with SmartAssistance**. Translation starts immediately after first-use
consent, using Vietnamese by default or your saved language. Clicking the
extension icon with selected text also starts translation. Change the language
in the dropdown to translate again automatically; there is no Translate button.
The side panel shows the original selection and its translation, each with a
sound icon. It does not offer Copy/Replace in reading mode. The
language is remembered locally. Without a selection, the toolbar keeps the
focused-editor writing workflow. First use requires consent before sending text.
Original text is collapsed by default so the translation gets more space. Click
**Original** to expand or collapse it; a new passage starts collapsed again.
Both text areas use compact 14px text and scroll internally. When Original is
expanded, the two areas share the available sidebar height and resize with the window.
While the panel is visible, select another passage on that same page to translate
it automatically after a brief pause. Hiding or closing the panel stops active
reading. Navigation or switching to another page requires invoking the extension
there again; writing fields are not monitored.

Click the sound icon beside Original or Translation to hear that passage. Select
a word or phrase in either text area first to hear only the selected text. The
same icon becomes Stop during playback; click it again to stop. The icons also
work with Tab and Enter/Space. The original language is detected locally by Chrome;
translation speech uses the selected target language. There is no pronunciation
language picker. Detection is best effort for short or mixed-language passages.
The spoken selection stays highlighted during and after playback, including when
you stop it. Clicking elsewhere clears the selection; replacing or clearing the
text also clears it.
Pronunciation uses only local device voices, with no additional API call. If a
language has no local voice, the panel names the missing language and offers
installation guidance. On Windows, **Open speech settings** opens voice management;
choose **Add voices**, select the language, and confirm the download. Then click
the sound icon again (restart Chrome if needed). Chrome cannot install OS voices
or guarantee that an installed voice is exposed to the browser.
Playback stops when the panel hides/closes, text or language changes, consent is
withdrawn, or the capture expires. Voice quality and availability vary by device.

## Current status

The local MVP is implemented: a Chrome extension and stateless API support
capture, rewrite, preview, copy, safe replacement, retry, cancellation, and undo.
It is not ready for public release. Production login, shared per-user quotas,
live model quality evaluation, and broader real-site manual verification remain open.
The user has reported working Replace in Gmail and successful Facebook/Messenger
retesting after the managed-editor compatibility change; see the
[manual verification record](docs/status.md#manual-verification-reported-on-2026-09-06)
for the scope of those results.

See [implementation status](docs/status.md) for validation evidence and remaining
work, and [the full architecture](docs/architecture/README.md) for components,
interfaces, lifecycle, security boundaries, and deployment.

## Local setup

1. Install Node.js 24 LTS.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and add an OpenAI API key.
4. Run `npm run dev:api` and `npm run dev:extension`.
5. Load `apps/extension/dist` as an unpacked Chrome extension.

See [the development guide](docs/development.md) for the complete workflow.
For step-by-step PowerShell instructions, dependency isolation, Chrome loading,
and daily startup, see [the Windows quickstart](docs/windows-quickstart.md).

For the complete validation gate, install the test browser once with
`npx playwright install chromium`, then run `npm run check`. Browser tests use
synthetic drafts and a local fake API; they do not call OpenAI.

Read [privacy and retention](docs/privacy.md) before sending real drafts.
For a limited friends-and-family deployment, see the
[private beta guide](docs/private-beta.md).

## Repository map

```text
.
|-- AGENTS.md                 Instructions for coding agents
|-- apps/
|   |-- api/                  Stateless rewrite API and OpenAI adapter
|   `-- extension/            Chrome Manifest V3 extension
|-- docs/
|   |-- architecture/         System boundaries and diagrams
|   |-- decisions/            Architecture decision records (ADRs)
|   `-- product/              Product goals and scope
`-- packages/
    `-- contracts/            Shared request and response contracts
```

## Working agreements

- Keep secrets out of Git. Copy `.env.example` to `.env` for local values.
- Prefer small, reviewable changes tied to an explicit outcome.
- Record each completed step and its validation in `docs/status.md`, update
  relevant documentation, and commit the step before starting the next one.
- Record consequential and hard-to-reverse choices as ADRs.
- Add automated tests with behavior changes.
- Run `npm run check` before opening a pull request.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and
[SECURITY.md](SECURITY.md) for security reporting.

## License

No license has been selected. Until one is added, reuse rights are not granted.
