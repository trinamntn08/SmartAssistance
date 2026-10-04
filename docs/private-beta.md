# Private Chrome Web Store beta

This guide deploys a short-lived, friends-and-family beta. It is not a public
release: the extension embeds one shared bearer token, which an installer can
extract. Use only with a small private tester list and a low OpenAI project
budget. See [ADR-0004](decisions/0004-private-beta-shared-token.md).

This hosted API and shared token support cloud writing. Reading translation runs
locally in desktop Chrome 138+ with available models and needs no backend or token;
see [local reading setup](local-translation-verification.md).

## What you need

- A GitHub repository containing this project.
- A Render account connected to that repository.
- A Chrome Web Store developer account.
- An OpenAI **project** API key. Keep it in Render only; never put it in GitHub,
  the extension, or the Chrome Web Store package. Official OpenAI documentation
  recommends loading API keys from server environment variables or a key
  management service. [OpenAI API key guidance](https://platform.openai.com/docs/api-reference/debugging-requests?lang=node.js)

No custom domain is required: Render provides an HTTPS service URL.

## 1. Push the project to GitHub

Create a private GitHub repository and push this checkout. Confirm that `.env`,
`dist`, and any API keys are absent from the repository. Render reads the
committed [`render.yaml`](../render.yaml) blueprint from the repository root.
Its build command explicitly installs the development-only bundler before
building the API, even though the running service uses `NODE_ENV=production`.

## 2. Create the Render API service

1. In Render, choose **New** then **Blueprint** and select the GitHub repository.
2. Accept the `smartassistance-api` service from `render.yaml`.
3. Before creating it, add values for the secret fields:
   - `OPENAI_API_KEY`: a project API key;
   - `SMARTASSISTANCE_API_TOKEN`: a new random shared beta token;
   - `SMARTASSISTANCE_ALLOWED_ORIGINS`: temporarily use
     `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.
4. Deploy and record the HTTPS URL Render assigns, for example
   `https://smartassistance-api.onrender.com`.
5. Confirm `<Render URL>/healthz` returns `status: "ok"` and
   `providerConfigured: true`.

The temporary origin is intentionally unusable; it only lets the production API
start until the Chrome Web Store assigns the extension ID. Do not use a wildcard
origin. Free Render services can sleep while idle, so expect a slower first
request after inactivity.

## 3. Build and upload the initial private extension

### Automated release command

After the first beta package exists, prepare every later Chrome Web Store update
from the repository root with one command:

```powershell
npm run release:extension
```

The command:

1. increments the final component of the extension version;
2. synchronizes `manifest.json`, the extension workspace package, and the lockfile;
3. runs the complete `npm run check` gate using the local test configuration;
4. rebuilds only the extension with the hosted API URL and beta token;
5. replaces `smartassistance-beta.zip`; and
6. verifies the ZIP version, root layout, HTTPS API origin, absence of the local
   API address, and reports its SHA-256 hash.

By default, it recovers the hosted URL and shared beta token from the previous
beta ZIP without printing them. This keeps the update workflow to one command
while the shared-token beta design remains in use. Keep the previous ZIP locally
and never commit it.

As a more explicit alternative, copy `.env.release.example` to the ignored local
file `.env.release.local`, replace both placeholders, and keep that file private:

```powershell
Copy-Item .env.release.example .env.release.local
```

Process environment variables take precedence over `.env.release.local`; the
previous ZIP is used only when either required value is still missing. To choose
a specific higher version instead of the automatic patch increment, run:

```powershell
npm run release:extension -- -Version 0.2.0
```

If validation or packaging fails, the command restores the three version files
to their starting contents and preserves the previous ZIP. It never
uploads or submits the ZIP; those external dashboard actions remain explicit.

For future assisted releases, ask: **“Prepare the next Chrome Web Store
extension release.”** The agent should run `npm run release:extension`, inspect
the reported version and hash, and hand off `smartassistance-beta.zip` for upload.

### Manual initial build

In PowerShell, use the Render URL and exactly the same beta token that is stored
in Render. Do not commit either value.

```powershell
$env:SMARTASSISTANCE_API_BASE_URL = "https://YOUR-RENDER-SERVICE.onrender.com"
$env:SMARTASSISTANCE_BETA_API_TOKEN = "YOUR-SHARED-BETA-TOKEN"
npm run build
Compress-Archive -Path apps/extension/dist/* -DestinationPath smartassistance-beta.zip -Force
```

In the Chrome Web Store Developer Dashboard, upload `smartassistance-beta.zip`
as a new item. Complete the listing and privacy disclosures, label it as a beta,
and set distribution to **Private**. Save the item and copy its extension ID.

## Store images

The Store requires a 128x128 PNG extension icon, a 440x280 promotional image,
and at least one 1280x800 screenshot. The build includes the extension icon;
the Store listing can upload `apps/extension/assets/promo-440x280.png`. Generate
the screenshot with the release handoff command below. It uses the tested side
panel and synthetic text; do not create Store screenshots from a real user's
draft.

The committed `apps/extension/assets/store-screenshot.png` is ready to upload.
To regenerate it after a UI change, first create the default local build, then
run:

```powershell
$env:SMARTASSISTANCE_CAPTURE_STORE_SCREENSHOT = "1"
npx playwright test tests/browser/extension.spec.ts --grep '#draft'
Remove-Item Env:SMARTASSISTANCE_CAPTURE_STORE_SCREENSHOT
```

Chrome assigns a stable extension ID to the Store item. Private distribution
limits installation to named testers; it does not keep the shared token secret.

## 4. Lock the API to that extension and publish the beta

1. Replace Render's temporary `SMARTASSISTANCE_ALLOWED_ORIGINS` value with:

   ```text
   chrome-extension://YOUR-CHROME-WEB-STORE-EXTENSION-ID
   ```

2. Redeploy the Render service.
3. Re-run the build and ZIP commands above, then upload the new ZIP as an update
   to the same Store item.
4. Add each friend as a trusted tester, or assign a Google Group you manage.
5. Submit the private beta for Chrome Web Store review and share its private
   installation link only after approval.

When rotating the beta token, change both Render's
`SMARTASSISTANCE_API_TOKEN` and the extension build's
`SMARTASSISTANCE_BETA_API_TOKEN`, redeploy Render, rebuild, and upload a new
extension version. Rotating only one side deliberately stops all beta rewrites.

## Operational limits and stop procedure

The blueprint limits the beta to five admitted requests per minute, one provider
call at a time, and 1,024 output tokens. OpenAI usage limits remain the ultimate
cost boundary. To stop the beta immediately, suspend the Render service or
rotate `SMARTASSISTANCE_API_TOKEN`; do not revoke the OpenAI key unless you need
to stop all applications using that project.

Record tester feedback without collecting their drafts. Before wider release,
replace this shared-token design with authentication, per-user quotas, and
durable usage accounting.
