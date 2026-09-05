# Development guide

## Prerequisites

- Git
- Node.js 24 LTS
- npm 11 or the npm version bundled with Node.js 24
- Google Chrome for manual extension testing

Check `node --version` in the shell running npm; it must be Node.js 24 or newer.
An older global installation can still take precedence over a downloaded runtime
and fail before tests start. Current implementation and validation evidence are
tracked in [implementation status](status.md).

## Local setup

1. Clone the repository.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` for live rewrites.
4. Run `npm run dev:api` in one terminal.
5. Run `npm run dev:extension` in another terminal.
6. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select `apps/extension/dist`.
7. Focus a supported field on a normal webpage and invoke SmartAssistance through
   its toolbar icon, context menu, or keyboard shortcut.
8. Read the first-use privacy disclosure. Accepting it enables Generate; capturing
   alone never sends draft text to the API.

To run validation, install Chromium once: `npx playwright install chromium`.
On Linux CI, use `npx playwright install --with-deps chromium`.

## Quality commands

| Check | Command |
| --- | --- |
| Format files | `npm run format` |
| Check formatting | `npm run format:check` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Unit tests | `npm test` |
| Build | `npm run build` |
| Chromium workflow tests (after a default local build) | `npm run test:browser` |
| Explicit live synthetic evaluation | `npm run eval:rewrites` |
| Complete gate | `npm run check` |

The local default API listens at `http://127.0.0.1:8787`. Anonymous calls are
allowed only when `NODE_ENV` is not `production`. A production process refuses to
start without `SMARTASSISTANCE_API_TOKEN`; this temporary token gate must be
replaced by user authentication before public release.
Request quotas currently apply to the whole API process, not individual users or
multiple replicas. Do not expose the local anonymous API on a public interface.

## Configuration

- Commit safe defaults and variable names in `.env.example`.
- Store developer secrets only in ignored local files or an approved secret
  manager.
- Fail fast when required configuration is missing or invalid.
- Never use production credentials in local development or automated tests.

| Variable | Default / behavior |
| --- | --- |
| `OPENAI_TIMEOUT_MS` | 15000; maximum 15000; no SDK retries |
| `OPENAI_MAX_OUTPUT_TOKENS` | 8192; configurable 128-16384; incomplete results are rejected |
| `RATE_LIMIT_PER_MINUTE` | 20 admitted rewrites per API process |
| `MAX_CONCURRENT_REWRITES` | 4 provider calls per API process |
| `MAX_BODY_BYTES` | 65536 |
| `SMARTASSISTANCE_ALLOWED_ORIGINS` | Exact comma-separated origins; required in production; wildcard rejected |
| `SMARTASSISTANCE_API_BASE_URL` | Export in the extension build shell; default `http://127.0.0.1:8787`; HTTPS required outside loopback |

With no origin list, development permits Chrome extension origins, and requests
without an Origin header. Other browser origins are rejected before provider work.
The HTTP request deadline is 18 seconds; the extension transport deadline is 20.
Client disconnect and Cancel abort the upstream request, without starting a retry.
Stopping a request cannot undo provider processing that already occurred.

The extension build does not automatically load `.env`; `dev:api` does. Changing
the API URL requires a rebuild, extension reload, and consent for that endpoint.

## Test strategy

Keep fast unit tests close to domain behavior. Add integration tests at external
boundaries and a small number of end-to-end tests for critical user workflows.
AI policy and synthetic evaluation cases are versioned in `apps/api/src`. See
[the evaluation guide](../apps/api/src/evaluations/README.md) for the explicit live
runner and human review requirements. `npm test` never makes a live provider call.

Chromium tests load a temporary copy of the built extension and grant host access
only to their ephemeral localhost fixture. They cover consent, replacement and undo
in supported editor types, stale results, changed drafts, expiry, cancellation,
navigation, and tab closure. Manual testing must still verify Chrome's user-gesture
`activeTab` grant via toolbar/context-menu/shortcut on representative real websites.
The fixtures do not establish compatibility with unsupported site-specific editors.

Generated output is excluded from linting, formatting, and test discovery. The
contracts build clears stale output and emits no test files. `npm run check` can
be run repeatedly after a build without formatting generated bundles.

## Manual extension checks

- Verify input, textarea, and contenteditable fields.
- Verify disabled, read-only, password, and unsupported fields are rejected.
- Start a rewrite, change the source field, then confirm Replace is refused.
- Verify preview, copy, replace, and undo through keyboard-only navigation.
- Confirm rich-text fields show the plain-text replacement warning.
