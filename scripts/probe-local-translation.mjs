// Isolated diagnostic: no website text, user profile, credentials, or cloud calls.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve("tmp", `translation-probe-${Date.now()}`);
const extension = resolve(root, "extension");
await mkdir(extension, { recursive: true });
await writeFile(
  resolve(extension, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "Local translation probe",
    version: "0.0.1",
    background: { service_worker: "worker.js" },
  }),
);
await writeFile(
  resolve(extension, "worker.js"),
  "chrome.runtime.onInstalled.addListener(() => {});",
);
await writeFile(
  resolve(extension, "probe.html"),
  '<!doctype html><html><body><button id="probe">Check local translation</button><script src="probe.js"></script></body></html>',
);
await writeFile(
  resolve(extension, "probe.js"),
  `
document.getElementById('probe').addEventListener('click', async () => {
  const result = {translator: typeof Translator, detector: typeof LanguageDetector, pairs: {}};
  try {
    if (typeof LanguageDetector !== 'undefined') result.detectorAvailability = await LanguageDetector.availability();
    if (typeof Translator !== 'undefined') for (const sourceLanguage of ['en', 'fr']) {
      result.pairs[sourceLanguage + '-vi'] = await Translator.availability({sourceLanguage, targetLanguage:'vi'});
    }
  } catch { result.error = 'Availability check failed'; }
  document.body.dataset.result = JSON.stringify(result);
});
`,
);
const context = await chromium.launchPersistentContext(resolve(root, "profile"), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/probe.html`);
  await page.locator("#probe").click();
  await page.waitForFunction(() => document.body.dataset.result, { timeout: 15_000 });
  console.log(
    JSON.stringify(
      {
        browser: await context.browser()?.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        result: JSON.parse(await page.evaluate(() => document.body.dataset.result)),
        limitation:
          "Headless isolated extension document; native side panel, downloads, and model quality require desktop verification.",
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
}
