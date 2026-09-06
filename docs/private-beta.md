# Private Chrome Web Store beta

This guide deploys a short-lived, friends-and-family beta. It is not a public
release: the extension embeds one shared bearer token, which an installer can
extract. Use only with a small private tester list and a low OpenAI project
budget. See [ADR-0004](decisions/0004-private-beta-shared-token.md).

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
