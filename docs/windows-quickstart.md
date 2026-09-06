# Build and run SmartAssistance on Windows

This guide uses PowerShell and the checkout at
`D:\dev\projects\SmartAssistance`. Substitute your checkout path if different.
SmartAssistance has two running parts: Chrome runs the extension, and a local
Node.js API receives rewrite requests and calls the model provider. Building
creates files; starting the API makes rewriting available. There is no desktop
installer or executable to launch for the extension.

## 1. Choose the isolation you need

You do not need a Python virtual environment (`venv` or Conda). This repository
uses Node.js and npm workspaces.

| Concern | How to handle it |
| --- | --- |
| Project dependencies | Run `npm ci` in the repository root. Dependencies live in this checkout's `node_modules`, shared by its workspaces. No global TypeScript or build-tool installation is needed. |
| Reproducible dependencies | Keep `package-lock.json`; `npm ci` installs from it and fails if it disagrees with `package.json`. It replaces an existing `node_modules`. |
| Node runtime | Use Node.js 24, matching `.node-version`. If other projects need different versions, use your Node version manager to select 24 before running commands. The file alone does not switch Node. |
| Local settings | Keep credentials in the ignored `.env` file. This is configuration, not a virtual environment. |
| Browser testing | Optionally create a separate Chrome profile and load the extension there to keep testing apart from your everyday browsing. |
| Operating-system isolation | npm dependencies and browser profiles are not security sandboxes. Use a VM if you need an isolated operating system; Docker is not required for this local workflow. |

For ordinary development, project-local dependencies, Node 24, and a separate
Chrome test profile are sufficient. There is no environment activation or
deactivation command. See the [official npm ci documentation](https://docs.npmjs.com/cli/commands/npm-ci/)
for clean-install behavior.

## 2. Check prerequisites

Install Node.js 24 and Google Chrome. Git is needed to clone or update the
repository. Open a new PowerShell window after installing Node, then run:

```powershell
Set-Location D:\dev\projects\SmartAssistance
node --version
npm --version
Get-Command node
```

Use Node 24 for the documented setup; the repository requires at least 24.
Use npm 11 or the npm version bundled with Node 24. If `node --version` shows an
older version, fix your runtime selection or PATH before continuing.

If PowerShell reports that `npm.ps1` cannot run because scripts are disabled,
use `npm.cmd` in place of `npm`, and `npx.cmd` in place of `npx`, in this guide.
You do not need to change the machine's execution policy.

## 3. Install dependencies once

From the repository root:

```powershell
npm ci
```

Wait for the command to finish successfully. This installs dependencies for the
API, extension, and shared contracts together. Do not run separate installs in
each app. Run it again after pulling dependency changes, or when you need a clean
dependency installation; it is not part of every launch.

## 4. Configure the local API

Create the local configuration only if it does not exist:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
notepad .env
```

Set `OPENAI_API_KEY` to your provider API key and save the file. Preserve an
existing key when editing. The local connection settings should remain:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=8787
```

Keep the remaining defaults from `.env.example` for the initial setup. The key
stays in the API's environment; never put it in the extension source or `dist`
folder. Live generation sends the draft to the configured provider and uses
your API account. Read [privacy and retention](privacy.md) before using real text.

The API can start without a key, but live rewrites will be unavailable.
`dev:api` loads `.env`; restart it after changing that file. The extension build
does not load `.env` automatically.

## 5. Build the application

```powershell
npm run build
Test-Path -LiteralPath apps/extension/dist/manifest.json
```

The build compiles the workspaces, including the API and extension. The second
command should print `True`. Chrome loads the generated directory:

```text
D:\dev\projects\SmartAssistance\apps\extension\dist
```

Do not edit generated files in `dist`; rebuilding replaces them. This command
does not start the API or install the extension in Chrome.

## 6. Start the API in terminal A

```powershell
Set-Location D:\dev\projects\SmartAssistance
npm run dev:api
```

Leave this terminal open. A startup log with `type: "server_started"` indicates
the server is listening. `providerConfigured: true` indicates a key was loaded,
but does not prove the key or configured model works.

In another PowerShell window, check the server:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8787/healthz
```

A successful health response establishes local API reachability, not provider
access. The address is an API endpoint, not an application homepage.

## 7. Load the extension in Chrome

1. Open Chrome, optionally in a dedicated test profile.
2. Enter `chrome://extensions` in the address bar.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select `D:\dev\projects\SmartAssistance\apps\extension\dist`.
6. Confirm SmartAssistance appears without a loading error.
7. Open the extensions menu in Chrome's toolbar and pin SmartAssistance.

Select the directory containing the generated `manifest.json`, not the
repository root or `apps/extension`. You do not need a ZIP or Chrome Web Store
upload for local use. Google also documents the
[unpacked-extension installation workflow](https://support.google.com/chrome/a/answer/2714278?hl=en).

## 8. Try a rewrite

1. Open a normal website containing a plain text input or textarea.
2. Enter a synthetic draft, such as `Hello team, can we move the meeting to Friday?`.
3. Keep the text field focused and invoke SmartAssistance with its toolbar icon,
   context menu, or `Alt+Shift+R`.
4. Read and accept the first-use disclosure to enable generation.
5. Choose Fix grammar or Improve writing. Improve writing also offers Natural or
   Formal style; then choose an output language and generate.
6. Review the preview. Choose Replace to apply it, or Copy to keep it separately.
7. Try Undo immediately after replacement to restore the previous text.

If the shortcut is unavailable, check `chrome://extensions/shortcuts` or use the
toolbar. Chrome internal pages such as `chrome://extensions` are not test editors.
Google Docs, canvas editors, and cross-origin frames are outside current scope.
Basic contenteditable fields are supported, but replacement can remove formatting.
Managed editors with Lexical/Draft markers use native text insertion; their Undo
restores plain text rather than original formatting. Gmail Replace and a later
Facebook/Messenger retest were reported working by the user on 2026-09-06.
This does not establish support for every composer; see the
[manual verification record](status.md#manual-verification-reported-on-2026-09-06).
If you edit the draft after capture, replacement is refused; capture it again.

## 9. Develop with automatic rebuilding in terminal B

Keep terminal A running the API. In terminal B:

```powershell
Set-Location D:\dev\projects\SmartAssistance
npm run dev:extension
```

This builds the extension and watches its sources. After an extension change:

1. Wait for a successful build in terminal B.
2. Open `chrome://extensions` and click Reload on SmartAssistance.
3. Refresh the website used for testing and focus the field again.
4. Invoke the extension again to start a fresh interaction.

The watcher does not reload Chrome for you. Restart it after changing build
environment variables. For changes to shared contracts, run the full build
again. API source changes restart the development API through Node's watcher.

## 10. Stop and launch again tomorrow

Press `Ctrl+C` in each running terminal to stop the API and optional build
watcher. The extension remains installed, but generation needs the API running.

For everyday use after initial setup:

```powershell
Set-Location D:\dev\projects\SmartAssistance
npm run dev:api
```

Then open Chrome and use the installed extension. Rebuilding is needed only
when its code or build configuration changes. Start `npm run dev:extension` in
a second terminal only when you want to work on extension code.

## 11. Run the validation gate

Install the test browser once, then run the configured checks:

```powershell
npx playwright install chromium
npm run check
```

`check` runs formatting checks, linting, type checking, unit/integration tests,
builds, and browser tests. Tests use synthetic drafts and a fake API; they do
not call the live provider. To apply the configured formatter:

```powershell
npm run format
```

Stop the extension watcher before the validation gate so two processes are not
writing its build directory simultaneously. Manual live rewriting is a separate
check from this automated gate.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `node` or `npm` is not recognized | Install/select Node 24, open a new terminal, and check PATH. |
| Build fails on an older Node installation | Run `node --version` in the same terminal as the build. |
| Chrome cannot find the manifest | Run `npm run build` successfully and select `apps/extension/dist`. |
| Extension still shows old behavior | Reload it in Chrome, refresh the website, and capture again. |
| API connection fails | Keep terminal A running and check `/healthz`. |
| Provider is unavailable | Check that `.env` contains the key, restart the API, and check its startup log. |
| Health succeeds but generation fails | Check the extension error and provider account/key/model configuration; health does not call the model. |
| `EADDRINUSE` at startup | Another process uses port 8787; stop your previous API instance if it is still running. |
| Field cannot be captured | Focus a supported editable field on a normal website and invoke again. |
| Replace is refused | The draft may have changed or the capture expired; capture the current draft again. |

If you deliberately change the API port to 8788, update `PORT` in `.env`, restart
the API, and set the extension endpoint in the shell that builds it:

```powershell
$env:SMARTASSISTANCE_API_BASE_URL = "http://127.0.0.1:8788"
npm run build
```

Reload the extension afterward and accept consent for the new endpoint.
The shell variable applies only to that terminal and child processes. To restore
the default build endpoint, remove it and rebuild, and restore API `PORT=8787`:

```powershell
Remove-Item Env:SMARTASSISTANCE_API_BASE_URL -ErrorAction SilentlyContinue
npm run build
```

## Local use versus public release

These steps produce a locally usable development extension. A public release
also needs a hosted HTTPS API, production authentication, shared per-user quotas,
live quality evaluation, real-site verification, and Chrome Web Store packaging.
The current temporary production token gate is not a finished login system.
See [implementation status](status.md) for the remaining release work and
[the development guide](development.md) for configuration details.
