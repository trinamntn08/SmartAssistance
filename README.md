# SmartAssistance

SmartAssistance is a privacy-first Chrome writing assistant that fixes grammar
or improves the complete text in a focused email, comment, or message field.

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
- Record consequential and hard-to-reverse choices as ADRs.
- Add automated tests with behavior changes.
- Run `npm run check` before opening a pull request.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and
[SECURITY.md](SECURITY.md) for security reporting.

## License

No license has been selected. Until one is added, reuse rights are not granted.
