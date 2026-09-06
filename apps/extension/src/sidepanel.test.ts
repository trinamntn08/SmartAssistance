// @vitest-environment jsdom
import panelHtml from "./sidepanel.html?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_DRAFT_STORAGE_KEY,
  PRIVACY_CONSENT_KEY,
  consentScope,
  type ExtensionRequest,
  type ExtensionResponse,
  type ReadyDraftState,
} from "./messages.js";

type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
let changed: StorageListener;
let finish: (response: ExtensionResponse) => void;
let send: ReturnType<typeof vi.fn<(request: ExtensionRequest) => Promise<ExtensionResponse>>>;
const apiUrl = "http://127.0.0.1:8787";
function ready(snapshotId = "draft-A"): ReadyDraftState {
  return {
    status: "ready",
    phase: "captured",
    tabId: 1,
    documentId: "document-A",
    draft: { snapshotId, text: snapshotId, richText: false, expiresAt: Date.now() + 60_000 },
  };
}
function button(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}
function field(id: string): HTMLTextAreaElement {
  return document.getElementById(id) as HTMLTextAreaElement;
}
function select(id: string): HTMLSelectElement {
  return document.getElementById(id) as HTMLSelectElement;
}
function emit(state: ReadyDraftState): void {
  changed({ [ACTIVE_DRAFT_STORAGE_KEY]: { newValue: state } }, "session");
}
function attempt(): Extract<ExtensionRequest, { type: "RUN_REWRITE" }> {
  const request = send.mock.calls.find(([value]) => value.type === "RUN_REWRITE")?.[0];
  if (request?.type !== "RUN_REWRITE") throw new Error("No rewrite request");
  return request;
}
function success(): ExtensionResponse {
  const request = attempt();
  return {
    ok: true,
    snapshotId: request.snapshotId,
    generationId: request.generationId,
    rewrite: { rewrittenText: "Rewrite A", requestId: "request-A", model: "fake" },
  };
}
beforeEach(async () => {
  vi.resetModules();
  document.documentElement.innerHTML = panelHtml;
  send = vi.fn(async (request: ExtensionRequest): Promise<ExtensionResponse> => {
    if (request.type === "RUN_REWRITE")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (request.type === "UNDO_ACTIVE_REWRITE") return { ok: true, undone: true };
    return { ok: true, cancelled: true };
  });
  vi.stubGlobal("__SMARTASSISTANCE_API_BASE_URL__", apiUrl);
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send },
    storage: {
      session: { get: async () => ({ [ACTIVE_DRAFT_STORAGE_KEY]: ready() }) },
      local: { get: async () => ({ [PRIVACY_CONSENT_KEY]: consentScope(apiUrl) }) },
      onChanged: {
        addListener: (listener: StorageListener) => {
          changed = listener;
        },
      },
    },
  });
  await import("./sidepanel.js");
  await vi.waitFor(() => expect(button("generate").disabled).toBe(false));
});
afterEach(() => {
  if (typeof changed === "function")
    changed({ [ACTIVE_DRAFT_STORAGE_KEY]: { newValue: undefined } }, "session");
  vi.unstubAllGlobals();
});
describe("preview identity and event ordering", () => {
  it("shows style only for Improve writing and omits it for Fix grammar", async () => {
    expect(document.getElementById("style-option")?.hidden).toBe(true);
    button("generate").click();
    expect(attempt().settings).toEqual({ operation: "grammar", targetLanguage: "same" });
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));

    select("operation").value = "improve";
    select("operation").dispatchEvent(new Event("change"));
    expect(document.getElementById("style-option")?.hidden).toBe(false);
  });

  it("retains a response delivered before the generating and preview storage events", async () => {
    button("generate").click();
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
    expect(button("replace").disabled).toBe(true);
    emit({ ...ready(), phase: "preview", generationId: attempt().generationId });
    expect(button("replace").disabled).toBe(false);
  });
  it("discards a response after a different draft was captured", async () => {
    button("generate").click();
    emit(ready("draft-B"));
    finish(success());
    await vi.waitFor(() => expect(button("generate").disabled).toBe(false));
    expect(field("original").value).toBe("draft-B");
    expect(field("preview").value).toBe("");
    expect(button("replace").disabled).toBe(true);
  });
  it("discards even a successful delayed response after local cancellation", async () => {
    button("generate").click();
    emit({ ...ready(), phase: "generating", generationId: attempt().generationId });
    button("cancel").click();
    emit(ready());
    finish(success());
    await vi.waitFor(() => expect(button("generate").disabled).toBe(false));
    expect(field("preview").value).toBe("");
  });
  it("shows a provider failure even before its state reset event arrives", async () => {
    button("generate").click();
    emit({ ...ready(), phase: "generating", generationId: attempt().generationId });
    finish({ ok: false, code: "INCOMPLETE_OUTPUT", message: "Try a shorter draft." });
    await vi.waitFor(() =>
      expect(document.getElementById("status")?.textContent).toBe("Try a shorter draft."),
    );
  });
  it("keeps undo reachable when an applied interaction is restored without a local preview", () => {
    emit({ ...ready(), phase: "applied", generationId: "generation-A" });
    expect(document.getElementById("result")?.hidden).toBe(true);
    expect(button("undo").hidden).toBe(false);
    expect(button("undo").disabled).toBe(false);
  });
});
