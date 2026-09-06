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
  reply(text: string): void;
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
          '<!doctype html><html><body><textarea id="draft">Original A</textarea><input id="email" type="email" value="before@example.com"><div id="rich" contenteditable="true"><b>Original rich text</b></div><input id="payment" autocomplete="cc-number" value="synthetic"><textarea id="readonly" readonly>private</textarea></body></html>',
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
      const source = await readFile(join(extensionPath, name), "utf8");
      if (!source.includes("http://127.0.0.1:8787"))
        throw new Error("Browser tests require the default local extension build.");
      await writeFile(join(extensionPath, name), source.replaceAll("http://127.0.0.1:8787", url));
    }
    const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      const extensionId = new URL(worker.url()).host;
      const editor = await context.newPage();
      await editor.goto(url);
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      app = {
        editor,
        panel,
        worker,
        hold: false,
        output: "Rewritten A\nSecond paragraph",
        calls: 0,
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
        reply(text) {
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
  await app.panel
    .getByRole("button", { name: "I agree to send drafts when I choose Generate" })
    .click();
}
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

test("late rewrite cannot be attached to a recaptured draft", async ({ app }) => {
  await app.capture("#draft");
  await accept(app);
  app.hold = true;
  await app.panel.locator("#generate").click();
  await expect.poll(() => app.calls).toBe(1);
  const old = await app.state();
  await app.editor.locator("#draft").fill("New draft B");
  await app.capture("#draft");
  app.reply("Old rewrite A");
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
  app.reply("Generated rewrite");
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
  app.reply("Cancelled output");
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
