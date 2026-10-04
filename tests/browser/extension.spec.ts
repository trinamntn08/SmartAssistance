import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { chromium, expect, test as base, type Page, type Worker } from "@playwright/test";
import type {
  ExtensionRequest,
  ExtensionResponse,
  ReadyDraftState,
} from "../../apps/extension/src/messages.js";

interface Harness {
  editor: Page;
  panel: Page;
  worker: Worker;
  capture(selector: string): Promise<ExtensionResponse>;
  send(request: ExtensionRequest): Promise<ExtensionResponse>;
  state(): Promise<ReadyDraftState | undefined>;
  reply(text: string): Promise<void>;
  localCalls(): Promise<number>;
  hold: boolean;
  output: string;
  calls: number;
}
const test = base.extend<{ app: Harness }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture arguments to use object destructuring.
  app: async ({}, use, testInfo) => {
    let app: Harness;
    let held: ServerResponse | undefined;
    const server = createServer((request, response) => {
      if (request.method === "POST" && request.url === "/v1/rewrites") {
        request.resume();
        request.on("end", () => {
          app.calls += 1;
          if (app.hold) held = response;
          else {
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                rewrittenText: app.output,
                requestId: "synthetic-request",
                model: "fake",
              }),
            );
          }
        });
      } else {
        response.setHeader("Content-Type", "text/html");
        response.end(
          '<!doctype html><html><body><p id="article">Bonjour Marie, rendez-vous le 12 mai.</p><p>Surrounding page text</p><textarea id="draft">Original A</textarea><input id="email" type="email" value="before@example.com"><div id="rich" contenteditable="true"><b>Original rich text</b></div><input id="payment" autocomplete="cc-number" value="synthetic"><textarea id="readonly" readonly>private</textarea></body></html>',
        );
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const extensionPath = resolve(testInfo.outputPath("extension"));
    await mkdir(extensionPath, { recursive: true });
    await cp("apps/extension/dist", extensionPath, { recursive: true });
    // Test-only permission grants access to this local fixture. Production uses activeTab.
    const manifest = JSON.parse(await readFile(join(extensionPath, "manifest.json"), "utf8"));
    manifest.host_permissions = [`${url}/*`];
    await writeFile(join(extensionPath, "manifest.json"), JSON.stringify(manifest));
    for (const name of ["service-worker.js", "sidepanel.js"]) {
      let source = await readFile(join(extensionPath, name), "utf8");
      if (name === "service-worker.js") {
        source = source.replaceAll(
          "chrome.tabs.onActivated.addListener(",
          '((listener) => chrome.tabs.onActivated.addListener(async (info) => { const tab = await chrome.tabs.get(info.tabId); if (tab.url !== chrome.runtime.getURL("sidepanel.html")) listener(info); }))(',
        );
      }
      if (!source.includes("http://127.0.0.1:8787"))
        throw new Error("Browser tests require the default local extension build.");
      await writeFile(join(extensionPath, name), source.replaceAll("http://127.0.0.1:8787", url));
    }
    const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.exposeBinding("localTranslationConfig", () => ({
      output: app.output,
      hold: app.hold,
    }));
    await context.addInitScript(() => {
      const state = {
        calls: [] as { text: string; sourceLanguage: string; targetLanguage: string }[],
        held: [] as ((text: string) => void)[],
        availability: "available",
        sourceLanguage: "fr",
        confidence: 0.99,
        fail: false,
        creates: 0,
        destroys: 0,
      };
      Reflect.set(window, "testLocalTranslation", state);
      Object.defineProperty(window, "LanguageDetector", {
        configurable: true,
        value: {
          availability: async () => "available",
          create: async () => ({
            detect: async () => [
              { detectedLanguage: state.sourceLanguage, confidence: state.confidence },
              { detectedLanguage: "en", confidence: 1 - state.confidence },
              { detectedLanguage: "und", confidence: 0 },
            ],
            destroy: () => {
              state.destroys += 1;
            },
          }),
        },
      });
      Object.defineProperty(window, "Translator", {
        configurable: true,
        value: {
          availability: async () => state.availability,
          create: async (pair: { sourceLanguage: string; targetLanguage: string }) => {
            state.creates += 1;
            state.availability = "available";
            return {
              translate: async (text: string) => {
                state.calls.push({ text, ...pair });
                if (state.fail) throw new Error("Synthetic local failure");
                const config = await Reflect.get(window, "localTranslationConfig")();
                // Intentionally ignore aborts to exercise stale-result protection.
                return config.hold
                  ? new Promise<string>((resolve) => state.held.push(resolve))
                  : config.output;
              },
              destroy: () => {
                state.destroys += 1;
              },
            };
          },
        },
      });
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      const extensionId = new URL(worker.url()).host;
      const editor = await context.newPage();
      await editor.goto(url);
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      // Regular test tabs stand in for a sidebar: focusing panel controls should
      // leave the underlying webpage active, as it does in Chrome's side panel.
      await worker.evaluate(async (siteUrl) => {
        const original = chrome.tabs.query.bind(chrome.tabs);
        const [source] = await original({ url: `${siteUrl}/*` });
        Object.defineProperty(chrome.tabs, "query", {
          value: async (query: chrome.tabs.QueryInfo) => {
            const tabs = await original(query);
            if (query.active && tabs[0]?.url === chrome.runtime.getURL("sidepanel.html") && source)
              return [source];
            return tabs;
          },
        });
      }, url);
      app = {
        editor,
        panel,
        worker,
        hold: false,
        output: "Rewritten A\nSecond paragraph",
        calls: 0,
        localCalls: () =>
          panel.evaluate(() => Reflect.get(window, "testLocalTranslation").calls.length),
        send: (request) => panel.evaluate((value) => chrome.runtime.sendMessage(value), request),
        state: () =>
          worker.evaluate(
            async () =>
              (await chrome.storage.session.get("activeDraftState")).activeDraftState as
                | ReadyDraftState
                | undefined,
          ),
        async capture(selector) {
          await editor.bringToFront();
          await editor.locator(selector).focus();
          return app.send({ type: "CAPTURE_ACTIVE_EDITOR" });
        },
        async reply(text) {
          await panel.evaluate((value) => {
            const state = Reflect.get(window, "testLocalTranslation");
            for (const resolve of state.held.splice(0)) resolve(value);
          }, text);
          if (held && !held.destroyed) {
            held.setHeader("Content-Type", "application/json");
            held.end(
              JSON.stringify({
                rewrittenText: text,
                requestId: "synthetic-request",
                model: "fake",
              }),
            );
          }
          held = undefined;
        },
      };
      await use(app);
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  },
});
async function accept(app: Harness): Promise<void> {
  await expect(
    app.panel.locator("#accept-local-reading:visible, #accept-privacy:visible"),
  ).toHaveCount(1);
  await app.panel.locator("#accept-local-reading:visible, #accept-privacy:visible").click();
}
test("selected text shows original and translation without Copy and remembers language", async ({
  app,
}, testInfo) => {
  await app.panel.setViewportSize({ width: 400, height: 800 });
  await app.editor.bringToFront();
  await app.editor.locator("#article").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  expect(await app.send({ type: "CAPTURE_ACTIVE_TEXT" })).toEqual({ ok: true, captured: true });
  expect(await app.state()).toMatchObject({
    source: "selection",
    draft: { text: "Bonjour Marie, rendez-vous le 12 mai." },
  });
  expect(app.calls).toBe(0);
  await expect(app.panel.locator("#original-section")).toBeVisible();
  await expect(app.panel.locator("#original")).toHaveValue("Bonjour Marie, rendez-vous le 12 mai.");
  await expect(app.panel.locator("#copy")).toBeHidden();
  await expect(app.panel.locator("#mode-option")).toBeHidden();
  await expect(app.panel.locator("#generate")).toBeHidden();
  await expect(app.panel.locator("#language")).toHaveValue("vi");
  await accept(app);
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  app.output = "Hello Marie, see you on May 12.";
  await app.panel.locator("#language").selectOption("en");
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  await expect(app.panel.locator("#replace")).toBeHidden();
  await app.panel.screenshot({ path: testInfo.outputPath("translation-panel.png") });
  await expect(app.editor.locator("#article")).toHaveText("Bonjour Marie, rendez-vous le 12 mai.");
  await app.panel.locator("#language").selectOption("fr");
  await expect(app.panel.locator("#preview")).toHaveValue("Bonjour Marie, rendez-vous le 12 mai.");
  await app.panel.reload();
  await expect(app.panel.locator("#language")).toHaveValue("fr");
  await expect(app.panel.locator("#original-section")).toBeVisible();
  await expect(app.panel.locator("#copy")).toBeHidden();
});
test("reading accepts copyable rendered text across hidden widgets and accessibility attributes", async ({
  app,
}) => {
  await app.editor.bringToFront();
  const copiedText = await app.editor.locator("#article").evaluate((element) => {
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("aria-readonly", "true");
    element.innerHTML =
      'Bonjour <span hidden>HIDDEN SECRET</span><input autocomplete="cc-number" value="FIELD SECRET"><textarea>TEXTAREA SECRET</textarea><span>Marie</span>';
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    return window.getSelection()?.toString();
  });
  expect(copiedText).toBe("Bonjour Marie");
  expect(await app.send({ type: "CAPTURE_ACTIVE_SELECTION" })).toMatchObject({ ok: true });
  expect(await app.state()).toMatchObject({ source: "selection", draft: { text: copiedText } });
  await accept(app);
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  expect(app.calls).toBe(0);
});

test("explicit reading translates only selected read-only field text without enabling writing", async ({
  app,
}) => {
  await app.editor.bringToFront();
  await app.editor.locator("#readonly").evaluate((element: HTMLTextAreaElement) => {
    element.value = "Outside Bonjour Marie Outside";
    element.focus();
    element.setSelectionRange(8, 21);
  });
  expect(await app.send({ type: "CAPTURE_ACTIVE_SELECTION" })).toMatchObject({ ok: true });
  expect(await app.state()).toMatchObject({
    source: "selection",
    draft: { text: "Bonjour Marie" },
  });
  await accept(app);
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  expect(await app.capture("#readonly")).toMatchObject({ ok: false });
  expect(app.calls).toBe(0);
});

test("translation fills the sidebar and adapts to window height without page scrolling", async ({
  app,
}, testInfo) => {
  await app.panel.setViewportSize({ width: 400, height: 800 });
  await app.editor.bringToFront();
  await app.editor.locator("#article").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await app.send({ type: "CAPTURE_ACTIVE_TEXT" });
  app.output = Array.from(
    { length: 80 },
    (_, index) => `Đoạn ${index + 1}: Đây là nội dung dịch dài để kiểm tra vùng đọc.`,
  ).join("\n\n");
  await accept(app);
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  await expect(app.panel.locator("#original")).toBeHidden();
  await expect(app.panel.locator("#original-toggle")).toHaveAttribute("aria-expanded", "false");
  expect(
    await app.panel.locator("#preview").evaluate((field) => getComputedStyle(field).fontSize),
  ).toBe("14px");
  const largeBox = await app.panel.locator("#preview").boundingBox();
  const largeOriginal = await app.panel.locator("#original").boundingBox();
  expect((largeBox?.height ?? 0) + (largeOriginal?.height ?? 0)).toBeGreaterThan(440);
  expect(
    await app.panel.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
  await app.panel.screenshot({ path: testInfo.outputPath("translation-expanded.png") });
  await app.panel.setViewportSize({ width: 320, height: 600 });
  const smallerBox = await app.panel.locator("#preview").boundingBox();
  const smallerOriginal = await app.panel.locator("#original").boundingBox();
  expect((smallerBox?.height ?? 0) + (smallerOriginal?.height ?? 0)).toBeGreaterThan(220);
  expect(smallerBox?.height).toBeLessThan(largeBox?.height ?? 0);
  expect(
    await app.panel.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
  await app.panel.screenshot({ path: testInfo.outputPath("translation-expanded-narrow.png") });
  await app.panel.getByRole("button", { name: "Show original text", exact: true }).press("Space");
  await expect(app.panel.locator("#original")).toBeVisible();
  await expect(app.panel.locator("#original")).toHaveAccessibleName("Original");
  const expandedBox = await app.panel.locator("#preview").boundingBox();
  expect(expandedBox?.height).toBeLessThan(smallerBox?.height ?? 0);
  expect(
    await app.panel.locator("#original").evaluate((field) => getComputedStyle(field).fontSize),
  ).toBe("14px");
  expect(
    await app.panel.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
  await app.panel.screenshot({ path: testInfo.outputPath("original-open-narrow.png") });
  await app.panel.getByRole("button", { name: "Hide original text", exact: true }).press("Enter");
  await expect(app.panel.locator("#original")).toBeHidden();
});

for (const target of ["vi", "en"]) {
  test(`first panel reveal automatically translates using ${target}`, async ({ app }) => {
    await app.panel.evaluate(async (saved) => {
      if (saved !== "vi") await chrome.storage.local.set({ translationLanguage: saved });
    }, target);
    await app.panel.addInitScript(() => {
      let visible = false;
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (visible ? "visible" : "hidden"),
      });
      Reflect.set(window, "showTestPanel", () => {
        visible = true;
        document.dispatchEvent(new Event("visibilitychange"));
      });
    });
    await app.panel.reload();
    await app.send({ type: "ACCEPT_LOCAL_READING_NOTICE" });
    await app.editor.bringToFront();
    await app.editor.locator("#article").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await app.send({ type: "CAPTURE_ACTIVE_TEXT" });
    await expect(app.panel.locator("#original")).toHaveValue(
      "Bonjour Marie, rendez-vous le 12 mai.",
    );
    await expect(app.panel.locator("#language")).toHaveValue(target);
    expect(app.calls).toBe(0);
    // Revealing a real sidebar leaves the selected webpage as the active tab.
    await app.panel.evaluate(() => Reflect.get(window, "showTestPanel")());
    await expect(app.panel.locator("#preview")).toHaveValue(app.output);
    expect(await app.localCalls()).toBe(1);
    expect(app.calls).toBe(0);
    await app.panel.evaluate(() => Reflect.get(window, "showTestPanel")());
    await app.panel.reload();
    await app.panel.evaluate(() => Reflect.get(window, "showTestPanel")());
    await expect(app.panel.locator("#language")).toHaveValue(target);
    expect(await app.localCalls()).toBe(0);
    expect(app.calls).toBe(0);
  });
}

test("sound icons read selected or full original and translated text", async ({
  app,
}, testInfo) => {
  await app.panel.addInitScript(() => {
    const state = {
      calls: [] as { text: string; lang: string; local: boolean }[],
      cancels: 0,
      available: true,
    };
    Reflect.set(window, "testSpeech", state);
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () =>
          state.available
            ? [
                { lang: "vi-VN", localService: true },
                { lang: "fr-FR", localService: true },
              ]
            : [{ lang: "vi-VN", localService: false }],
        speak: (utterance: SpeechSynthesisUtterance) =>
          state.calls.push({
            text: utterance.text,
            lang: utterance.lang,
            local: utterance.voice?.localService === true,
          }),
        cancel: () => {
          state.cancels += 1;
        },
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(chrome.i18n, "detectLanguage", {
      value: async () => ({ isReliable: true, languages: [{ language: "fr", percentage: 100 }] }),
    });
  });
  await app.panel.reload();
  await app.panel.setViewportSize({ width: 400, height: 800 });
  await app.editor.bringToFront();
  await app.editor.locator("#article").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  app.output = "Bonjour, Marie.\nEncore.";
  await app.send({ type: "CAPTURE_ACTIVE_TEXT" });
  await accept(app);
  await expect(app.panel.locator("#original")).toHaveValue("Bonjour Marie, rendez-vous le 12 mai.");
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  const calls = app.calls;
  await app.panel.locator("#preview").evaluate((field: HTMLTextAreaElement) => {
    field.focus();
    field.setSelectionRange(0, 7);
  });
  await app.panel.getByRole("button", { name: "Listen to translation", exact: true }).click();
  await expect(app.panel.locator("#translation-sound")).toHaveAccessibleName("Stop playback");
  expect(await app.panel.evaluate(() => Reflect.get(window, "testSpeech").calls)).toEqual([
    { text: "Bonjour", lang: "vi-VN", local: true },
  ]);
  await expect(app.panel.locator("#preview")).toBeFocused();
  expect(
    await app.panel
      .locator("#preview")
      .evaluate((field: HTMLTextAreaElement) =>
        field.value.slice(field.selectionStart, field.selectionEnd),
      ),
  ).toBe("Bonjour");
  await app.panel.screenshot({ path: testInfo.outputPath("retained-speech-highlight.png") });
  await app.panel.locator("#translation-sound").press("Space");
  await expect(app.panel.locator("#translation-sound")).toHaveAccessibleName(
    "Listen to translation",
  );
  await expect(app.panel.locator("#preview")).toBeFocused();
  expect(
    await app.panel
      .locator("#preview")
      .evaluate((field: HTMLTextAreaElement) => field.selectionEnd - field.selectionStart),
  ).toBe(7);
  await app.panel.locator("#preview-label").click();
  expect(
    await app.panel
      .locator("#preview")
      .evaluate((field: HTMLTextAreaElement) => field.selectionEnd - field.selectionStart),
  ).toBe(0);
  await app.panel
    .locator("#preview")
    .evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(0, 0));
  await app.panel.locator("#translation-sound").press("Enter");
  expect(await app.panel.evaluate(() => Reflect.get(window, "testSpeech").calls.at(-1).text)).toBe(
    app.output,
  );
  await app.panel.getByRole("button", { name: "Show original text", exact: true }).click();
  await app.panel.locator("#original").evaluate((field: HTMLTextAreaElement) => {
    field.focus();
    field.setSelectionRange(8, 13);
  });
  await app.panel.getByRole("button", { name: "Listen to original", exact: true }).click();
  await expect(app.panel.locator("#original-sound")).toHaveAccessibleName("Stop playback");
  await expect(app.panel.locator("#original")).toBeFocused();
  expect(
    await app.panel
      .locator("#original")
      .evaluate((field: HTMLTextAreaElement) =>
        field.value.slice(field.selectionStart, field.selectionEnd),
      ),
  ).toBe("Marie");
  expect(await app.panel.evaluate(() => Reflect.get(window, "testSpeech").calls.at(-1))).toEqual({
    text: "Marie",
    lang: "fr-FR",
    local: true,
  });
  await app.panel.locator("#original-sound").click();
  await app.panel
    .locator("#original")
    .evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(0, 0));
  await app.panel.locator("#original-sound").click();
  await expect(app.panel.locator("#original-sound")).toHaveAccessibleName("Stop playback");
  expect(await app.panel.evaluate(() => Reflect.get(window, "testSpeech").calls.at(-1))).toEqual({
    text: "Bonjour Marie, rendez-vous le 12 mai.",
    lang: "fr-FR",
    local: true,
  });
  expect(app.calls).toBe(calls);
  await app.panel.screenshot({ path: testInfo.outputPath("simple-sound-panel.png") });
  await app.panel.locator("#original-sound").click();
  await app.panel.evaluate(() => {
    Reflect.get(window, "testSpeech").available = false;
  });
  await app.panel.locator("#translation-sound").click();
  await expect(app.panel.locator("#speech-status")).toContainText("No local voice");
  await expect(app.panel.locator("#voice-install")).toBeVisible();
  await expect(app.panel.locator("#voice-install-instructions")).toContainText("Vietnamese");
  await expect(app.panel.locator("#voice-settings")).toHaveAttribute("href", "ms-settings:speech");
  await app.panel.screenshot({ path: testInfo.outputPath("missing-voice-installation.png") });
  expect(await app.panel.evaluate(() => Reflect.get(window, "testSpeech").calls.length)).toBe(4);
  await app.panel.evaluate(() => {
    Reflect.get(window, "testSpeech").available = true;
  });
  await app.panel.locator("#translation-sound").click();
  await expect(app.panel.locator("#voice-install")).toBeHidden();
  await app.panel.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(app.panel.locator("#translation-sound")).toHaveAccessibleName(
    "Listen to translation",
  );
  expect(await app.panel.evaluate(() => Reflect.get(window, "testSpeech").cancels)).toBeGreaterThan(
    0,
  );
});

test("context-menu translation starts after first consent and later runs immediately", async ({
  app,
}) => {
  async function selectArticle(): Promise<void> {
    await app.editor.bringToFront();
    await app.editor.locator("#article").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
  }
  app.output = "Xin chào Marie, hẹn gặp vào ngày 12 tháng 5.";
  await selectArticle();
  expect(await app.send({ type: "CAPTURE_ACTIVE_SELECTION" })).toEqual({
    ok: true,
    captured: true,
  });
  expect(app.calls).toBe(0);
  await accept(app);
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  await expect(app.panel.locator("#language")).toHaveValue("vi");
  expect(await app.localCalls()).toBe(1);
  expect(app.calls).toBe(0);
  app.output = "Bản dịch tiếp theo.";
  await selectArticle();
  await app.send({ type: "CAPTURE_ACTIVE_SELECTION" });
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  expect(await app.localCalls()).toBe(2);
  expect(app.calls).toBe(0);
  await app.panel.reload();
  await expect(app.panel.locator("#generate")).toBeHidden();
  expect(await app.localCalls()).toBe(0);
  expect(app.calls).toBe(0);
  await expect(app.panel.locator("#copy")).toBeHidden();
});
test("active reading translates new selections and stops when the panel is hidden or closed", async ({
  app,
}) => {
  // A test tab stands in for Chrome's visible sidebar while the article receives focus.
  await app.panel.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  async function selectText(text: string): Promise<void> {
    await app.editor.bringToFront();
    await app.editor.locator("#article").evaluate((element, value) => {
      element.textContent = value;
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, text);
  }
  await selectText("Synthetic first passage");
  await app.send({ type: "CAPTURE_ACTIVE_TEXT" });
  await accept(app);
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  app.output = "New reading translation";
  await selectText("Synthetic next passage");
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  expect(await app.localCalls()).toBe(2);
  expect(app.calls).toBe(0);
  // Explicit polling proves duplicate selections do not request another model call.
  expect(await app.send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
  expect(await app.localCalls()).toBe(2);
  expect(app.calls).toBe(0);
  await app.panel.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await selectText("Synthetic hidden-panel passage");
  expect(await app.send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
  expect(await app.localCalls()).toBe(2);
  expect(app.calls).toBe(0);
  const callsBeforeClose = await app.localCalls();
  await app.panel.close();
  await selectText("Synthetic closed-panel passage");
  // Wait beyond two polling intervals to catch unintended background requests.
  await app.editor.waitForTimeout(1500);
  expect(await app.state()).toMatchObject({ draft: { text: "Synthetic next passage" } });
  expect(callsBeforeClose).toBe(2);
  expect(app.calls).toBe(0);
});
async function captureArticle(app: Harness, text?: string): Promise<void> {
  await app.editor.bringToFront();
  await app.editor.locator("#article").evaluate((element, value) => {
    if (value !== undefined) element.textContent = value;
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, text);
  await app.send({ type: "CAPTURE_ACTIVE_SELECTION" });
}

test("local reading requires its own notice and never grants cloud writing consent", async ({
  app,
}) => {
  await captureArticle(app);
  const state = await app.state();
  expect(
    await app.send({
      type: "BEGIN_LOCAL_TRANSLATION",
      snapshotId: state?.draft.snapshotId ?? "",
      generationId: "without-local-consent",
      targetLanguage: "vi",
    }),
  ).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
  expect(await app.localCalls()).toBe(0);
  await accept(app);
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  expect(
    await app.panel.evaluate(async () => {
      const stored = await chrome.storage.local.get(["localReadingConsent", "privacyConsent"]);
      return stored;
    }),
  ).toEqual({ localReadingConsent: "2026-10-04.1" });
  expect(
    await app.panel.evaluate(() => Reflect.get(window, "testLocalTranslation").calls),
  ).toMatchObject([
    { text: "Bonjour Marie, rendez-vous le 12 mai.", sourceLanguage: "fr", targetLanguage: "vi" },
  ]);
  expect(JSON.stringify(await app.state())).not.toContain(app.output);
  expect(app.calls).toBe(0);
  await app.capture("#draft");
  await expect(app.panel.locator("#accept-privacy")).toBeVisible();
  await expect(app.panel.locator("#generate")).toBeDisabled();
});

test("missing browser translation API reports unavailability without cloud fallback", async ({
  app,
}) => {
  await app.panel.addInitScript(() => {
    Object.defineProperty(window, "Translator", { configurable: true, value: undefined });
  });
  await app.panel.reload();
  await captureArticle(app);
  await accept(app);
  await expect(app.panel.locator("#status")).toContainText("Local translation is unavailable");
  await expect(app.panel.locator("#result")).toBeHidden();
  expect(await app.localCalls()).toBe(0);
  expect(app.calls).toBe(0);
});

for (const failure of ["unsupported", "uncertain", "failed"] as const) {
  test(`local ${failure} stays offline and can retry after recovery`, async ({ app }) => {
    await app.panel.evaluate((kind) => {
      const local = Reflect.get(window, "testLocalTranslation");
      if (kind === "unsupported") local.availability = "unavailable";
      if (kind === "uncertain") local.confidence = 0.55;
      if (kind === "failed") local.fail = true;
    }, failure);
    await captureArticle(app);
    await accept(app);
    const expected =
      failure === "unsupported"
        ? "cannot translate this language pair"
        : failure === "uncertain"
          ? "confidently identify"
          : "Local translation failed";
    await expect(app.panel.locator("#status")).toContainText(expected);
    await expect(app.panel.locator("#result")).toBeHidden();
    await expect(app.panel.locator("#local-translation-action")).toHaveText(
      "Retry local translation",
    );
    expect(app.calls).toBe(0);
    await app.panel.evaluate(() => {
      const local = Reflect.get(window, "testLocalTranslation");
      local.availability = "available";
      local.confidence = 0.99;
      local.fail = false;
    });
    await app.panel.locator("#local-translation-action").click();
    await expect(app.panel.locator("#preview")).toHaveValue(app.output);
    expect(app.calls).toBe(0);
  });
}

test("automatic reading requests an explicit click for language model setup", async ({ app }) => {
  await app.send({ type: "ACCEPT_LOCAL_READING_NOTICE" });
  await app.panel.evaluate(() => {
    Reflect.get(window, "testLocalTranslation").availability = "downloadable";
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: false },
    });
  });
  await captureArticle(app);
  await expect(app.panel.locator("#local-translation-action")).toHaveText(
    "Enable local translation",
  );
  expect(await app.localCalls()).toBe(0);
  expect(await app.panel.evaluate(() => Reflect.get(window, "testLocalTranslation").creates)).toBe(
    0,
  );
  await app.panel.evaluate(() => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
  });
  await app.panel.locator("#local-translation-action").click();
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  expect(await app.localCalls()).toBe(1);
  expect(app.calls).toBe(0);
});

test("language changes discard held local output even when the browser ignores abort", async ({
  app,
}) => {
  app.hold = true;
  await captureArticle(app);
  await accept(app);
  await expect.poll(() => app.localCalls()).toBe(1);
  await expect
    .poll(() => app.panel.evaluate(() => Reflect.get(window, "testLocalTranslation").held.length))
    .toBe(1);
  app.hold = false;
  app.output = "Fresh English translation";
  await app.panel.locator("#language").selectOption("en");
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  await app.reply("Obsolete Vietnamese translation");
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  expect(await app.localCalls()).toBe(2);
  expect(app.calls).toBe(0);
});

test("clearing private data cancels local reading and removes both consents", async ({ app }) => {
  app.hold = true;
  await captureArticle(app);
  await accept(app);
  await expect
    .poll(() => app.panel.evaluate(() => Reflect.get(window, "testLocalTranslation").held.length))
    .toBe(1);
  await app.panel.locator("#clear-private-data").click();
  await expect.poll(() => app.state()).toBeUndefined();
  await app.reply("Cancelled local result");
  await expect(app.panel.locator("#result")).toBeHidden();
  await expect(app.panel.locator("#original")).toHaveValue("");
  expect(
    await app.panel.evaluate(async () =>
      chrome.storage.local.get(["localReadingConsent", "privacyConsent"]),
    ),
  ).toEqual({});
  expect(app.calls).toBe(0);
});

for (const [selector, output] of [
  ["#draft", "Rewritten A\nSecond paragraph"],
  ["#email", "after@example.com"],
  ["#rich", "First paragraph\n\nSecond paragraph"],
]) {
  test(`capture, consent, preview, replace, undo ${selector}`, async ({ app }) => {
    if (!selector || !output) throw new Error("Invalid fixture");
    const original = await app.editor
      .locator(selector)
      .evaluate((element) =>
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value
          : element.innerHTML,
      );
    expect(await app.capture(selector)).toMatchObject({ ok: true });
    await expect(app.panel.locator("#result")).toBeHidden();
    await expect(app.panel.locator("#generate")).toBeDisabled();
    await accept(app);
    app.output = output;
    await app.panel.locator("#generate").click();
    await expect(app.panel.locator("#preview")).toHaveValue(output);
    if (process.env.SMARTASSISTANCE_CAPTURE_STORE_SCREENSHOT === "1" && selector === "#draft") {
      await app.panel.setViewportSize({ width: 1280, height: 800 });
      await app.panel.screenshot({ path: "apps/extension/assets/store-screenshot.png" });
    }
    await app.panel.locator("#replace").click();
    await expect(app.panel.locator("#undo")).toBeEnabled();
    expect(
      await app.editor
        .locator(selector)
        .evaluate((element) =>
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : (element as HTMLElement).innerText,
        ),
    ).toBe(output);
    await app.panel.reload();
    await expect(app.panel.locator("#result")).toBeHidden();
    await expect(app.panel.locator("#undo")).toBeVisible();
    await expect(app.panel.locator("#undo")).toBeEnabled();
    await app.panel.locator("#undo").click();
    await expect
      .poll(() =>
        app.editor
          .locator(selector)
          .evaluate((element) =>
            element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
              ? element.value
              : element.innerHTML,
          ),
      )
      .toBe(original);
  });
}
test("managed editor receives native input and retains replacement and undo", async ({ app }) => {
  await app.editor.locator("#rich").evaluate((element) => {
    element.setAttribute("data-lexical-editor", "true");
    element.addEventListener("input", (event) => {
      if (event instanceof InputEvent && event.inputType === "insertText") {
        element.setAttribute("data-accepted-text", (element as HTMLElement).innerText);
      }
    });
  });
  await app.capture("#rich");
  await accept(app);
  app.output = "<b>Plain text</b>\nSecond line";
  await app.panel.locator("#generate").click();
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  await app.panel.locator("#replace").click();
  await expect(app.panel.locator("#undo")).toBeEnabled();
  await expect(app.editor.locator("#rich")).toHaveAttribute("data-accepted-text", app.output);
  expect(await app.editor.locator("#rich").innerText()).toBe(app.output);
  await app.panel.locator("#undo").click();
  await expect(app.editor.locator("#rich")).toHaveAttribute(
    "data-accepted-text",
    "Original rich text",
  );
  expect(await app.editor.locator("#rich").innerText()).toBe("Original rich text");
});

test("managed editor that restores its own state does not report successful replacement", async ({
  app,
}) => {
  await app.editor.locator("#rich").evaluate((element) => {
    element.setAttribute("data-lexical-editor", "true");
    const original = element.innerHTML;
    element.addEventListener("input", () => {
      queueMicrotask(() => {
        element.innerHTML = original;
      });
    });
  });
  await app.capture("#rich");
  await accept(app);
  await app.panel.locator("#generate").click();
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  await app.panel.locator("#replace").click();
  await expect(app.panel.locator("#status")).toContainText("did not accept");
  expect(await app.editor.locator("#rich").innerText()).toBe("Original rich text");
  await expect(app.panel.locator("#copy")).toBeVisible();
});

for (const managed of [false, true]) {
  test(`shadow editor replacement and undo update host state (managed=${managed})`, async ({
    app,
  }) => {
    await app.editor.evaluate((useManaged) => {
      const host = document.createElement("div");
      host.id = "shadow-host";
      const nestedHost = document.createElement("div");
      host.attachShadow({ mode: "open" }).append(nestedHost);
      const root = nestedHost.attachShadow({ mode: "open" });
      root.innerHTML = useManaged
        ? '<div id="shadow-editor" contenteditable="true" data-lexical-editor="true">Original shadow draft</div>'
        : '<textarea id="shadow-editor">Original shadow draft</textarea>';
      const editor = root.querySelector<HTMLElement>("#shadow-editor");
      if (!editor) throw new Error("Missing shadow editor");
      host.addEventListener("input", () => {
        host.dataset.model =
          editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText;
      });
      document.body.append(host);
    }, managed);
    expect(await app.capture("#shadow-editor")).toMatchObject({ ok: true });
    await accept(app);
    app.output = "<b>Plain shadow text</b>\nSecond line";
    await app.panel.locator("#generate").click();
    await expect(app.panel.locator("#preview")).toHaveValue(app.output);
    await app.panel.locator("#replace").click();
    await expect(app.panel.locator("#undo")).toBeEnabled();
    await expect(app.editor.locator("#shadow-host")).toHaveAttribute("data-model", app.output);
    await app.panel.locator("#undo").click();
    await expect(app.editor.locator("#shadow-host")).toHaveAttribute(
      "data-model",
      "Original shadow draft",
    );
  });
}

test("shadow host restrictions prevent capture and stale replacement", async ({ app }) => {
  await app.editor.evaluate(() => {
    const host = document.createElement("div");
    host.id = "shadow-host";
    host.attachShadow({ mode: "open" }).innerHTML =
      '<textarea id="shadow-editor">Original shadow draft</textarea>';
    host.setAttribute("aria-readonly", "true");
    document.body.append(host);
  });
  expect(await app.capture("#shadow-editor")).toMatchObject({ ok: false });
  await app.editor
    .locator("#shadow-host")
    .evaluate((host) => host.removeAttribute("aria-readonly"));
  expect(await app.capture("#shadow-editor")).toMatchObject({ ok: true });
  await accept(app);
  await app.panel.locator("#generate").click();
  await expect(app.panel.locator("#preview")).toHaveValue(app.output);
  await app.editor
    .locator("#shadow-host")
    .evaluate((host) => host.setAttribute("aria-disabled", "true"));
  await app.panel.locator("#replace").click();
  await expect(app.panel.locator("#status")).toContainText("unavailable");
  await expect(app.editor.locator("#shadow-editor")).toHaveValue("Original shadow draft");
});

test("late rewrite cannot be attached to a recaptured draft", async ({ app }) => {
  await app.capture("#draft");
  await accept(app);
  app.hold = true;
  await app.panel.locator("#generate").click();
  await expect.poll(() => app.calls).toBe(1);
  const old = await app.state();
  await app.editor.locator("#draft").fill("New draft B");
  await app.capture("#draft");
  await app.reply("Old rewrite A");
  await expect(app.panel.locator("#original")).toHaveValue("New draft B");
  await expect(app.panel.locator("#result")).toBeHidden();
  expect(
    await app.send({
      type: "APPLY_ACTIVE_REWRITE",
      snapshotId: old?.draft.snapshotId ?? "",
      generationId: old?.generationId ?? "",
      text: "Old rewrite A",
    }),
  ).toMatchObject({ ok: false, code: "CONFLICT" });
  await expect(app.editor.locator("#draft")).toHaveValue("New draft B");
});
test("changed editor refuses replacement and keeps a copyable preview", async ({ app }) => {
  await app.capture("#draft");
  await accept(app);
  app.hold = true;
  await app.panel.locator("#generate").click();
  await expect.poll(() => app.calls).toBe(1);
  await app.editor.locator("#draft").fill("User kept typing");
  await app.reply("Generated rewrite");
  await expect(app.panel.locator("#preview")).toHaveValue("Generated rewrite");
  await app.panel.locator("#replace").click();
  await expect(app.panel.locator("#status")).toContainText("not overwritten");
  await expect(app.editor.locator("#draft")).toHaveValue("User kept typing");
  await expect(app.panel.locator("#copy")).toBeVisible();
});
test("consent cannot be bypassed, cancellation and clearing discard state", async ({ app }) => {
  await app.capture("#draft");
  const state = await app.state();
  expect(
    await app.send({
      type: "RUN_REWRITE",
      snapshotId: state?.draft.snapshotId ?? "",
      generationId: "attempt",
      settings: { operation: "grammar", targetLanguage: "same" },
    }),
  ).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
  expect(app.calls).toBe(0);
  await accept(app);
  app.hold = true;
  await app.panel.locator("#generate").click();
  await expect.poll(() => app.calls).toBe(1);
  await app.panel.locator("#cancel").click();
  await expect.poll(async () => (await app.state())?.phase).toBe("captured");
  await app.reply("Cancelled output");
  await expect(app.panel.locator("#result")).toBeHidden();
  await app.panel.locator("#clear-private-data").click();
  await expect.poll(() => app.state()).toBeUndefined();
  await expect(app.panel.locator("#original")).toHaveValue("");
  await expect(app.panel.locator("#privacy-notice")).toBeVisible();
});
test("navigation and source-tab closure clear private text", async ({ app }) => {
  await app.capture("#draft");
  await app.editor.reload();
  await expect.poll(() => app.state()).toBeUndefined();
  await expect(app.panel.locator("#workspace")).toBeHidden();
  await app.capture("#draft");
  await app.editor.close();
  await expect.poll(() => app.state()).toBeUndefined();
});
test("expiry alarm clears snapshot and UI", async ({ app }) => {
  await app.capture("#draft");
  await app.worker.evaluate(async () => {
    const stored = await chrome.storage.session.get("activeDraftState");
    const state = stored.activeDraftState as { draft: { expiresAt: number } };
    state.draft.expiresAt = Date.now() - 1;
    await chrome.storage.session.set({ activeDraftState: state });
    await chrome.alarms.create("expire-private-draft", { when: Date.now() + 50 });
  });
  await expect.poll(() => app.state()).toBeUndefined();
  await expect(app.panel.locator("#original")).toHaveValue("");
});
test("payment and read-only fields cannot be captured", async ({ app }) => {
  expect(await app.capture("#payment")).toMatchObject({ ok: false });
  expect(await app.capture("#readonly")).toMatchObject({ ok: false });
  await expect(app.panel.locator("#workspace")).toBeHidden();
});
