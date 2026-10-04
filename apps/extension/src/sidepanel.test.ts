// @vitest-environment jsdom
import panelHtml from "./sidepanel.html?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalTranslationError } from "./local-translation.js";
import {
  ACTIVE_DRAFT_STORAGE_KEY,
  PRIVACY_CONSENT_KEY,
  LOCAL_READING_CONSENT_KEY,
  LOCAL_READING_NOTICE_VERSION,
  consentScope,
  READING_READY_MESSAGE,
  type ExtensionRequest,
  type ExtensionResponse,
  type ReadyDraftState,
} from "./messages.js";

type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
let changed: StorageListener;
let finish: (response: ExtensionResponse) => void;
let send: ReturnType<typeof vi.fn<(request: ExtensionRequest) => Promise<ExtensionResponse>>>;
let detect: ReturnType<
  typeof vi.fn<(text: string) => Promise<chrome.i18n.LanguageDetectionResult>>
>;
let acknowledgeReading: (message: unknown) => void;
let autoAcknowledge = true;
const localMock = vi.hoisted(() => ({ translate: vi.fn(), dispose: vi.fn() }));
vi.mock("./local-translation.js", async (original) => ({
  ...(await original<typeof import("./local-translation.js")>()),
  browserLocalTranslationPlatform: () => undefined,
  createLocalTranslation: () => localMock,
}));
let localResponse: Promise<ExtensionResponse>;
function generationCalls(): Extract<ExtensionRequest, { type: "RUN_REWRITE" }>[] {
  return send.mock.calls.flatMap(([value]) =>
    value.type === "RUN_REWRITE"
      ? [value]
      : value.type === "BEGIN_LOCAL_TRANSLATION"
        ? [
            {
              type: "RUN_REWRITE" as const,
              snapshotId: value.snapshotId,
              generationId: value.generationId,
              settings: { operation: "translate" as const, targetLanguage: value.targetLanguage },
            },
          ]
        : [],
  );
}
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
  const request = generationCalls()[0];
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
  autoAcknowledge = true;
  document.documentElement.innerHTML = panelHtml;
  localMock.translate.mockReset();
  localMock.dispose.mockReset();
  localMock.translate.mockImplementation(async () => {
    const response = await localResponse;
    if (!response.ok || !("rewrite" in response)) throw new Error("Synthetic local failure");
    return { text: response.rewrite.rewrittenText, sourceLanguage: "fr" };
  });
  send = vi.fn(async (request: ExtensionRequest): Promise<ExtensionResponse> => {
    if (request.type === "BEGIN_LOCAL_TRANSLATION") {
      localResponse = new Promise((resolve) => {
        finish = resolve;
      });
      return { ok: true, localStarted: true };
    }
    if (request.type === "COMPLETE_LOCAL_TRANSLATION") return { ok: true, localCompleted: true };
    if (request.type === "RUN_REWRITE")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (request.type === "UNDO_ACTIVE_REWRITE") return { ok: true, undone: true };
    return { ok: true, cancelled: true };
  });
  vi.stubGlobal("__SMARTASSISTANCE_API_BASE_URL__", apiUrl);
  detect = vi.fn(async () => ({
    isReliable: true,
    languages: [{ language: "fr", percentage: 100 }],
  }));
  vi.stubGlobal("speechSynthesis", {
    getVoices: vi.fn(() => [
      { lang: "vi-VN", localService: true },
      { lang: "fr-FR", localService: true },
    ]),
    speak: vi.fn(),
    cancel: vi.fn(),
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  vi.stubGlobal("chrome", {
    i18n: { detectLanguage: detect },
    runtime: {
      sendMessage: send,
      connect: vi.fn(() => ({
        disconnect: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
        onMessage: {
          addListener: (listener: (message: unknown) => void) => {
            acknowledgeReading = listener;
            if (autoAcknowledge) listener(READING_READY_MESSAGE);
          },
        },
      })),
    },
    storage: {
      session: { get: async () => ({ [ACTIVE_DRAFT_STORAGE_KEY]: ready() }) },
      local: {
        get: vi.fn(async () => ({
          [PRIVACY_CONSENT_KEY]: consentScope(apiUrl),
          [LOCAL_READING_CONSENT_KEY]: LOCAL_READING_NOTICE_VERSION,
        })),
        set: vi.fn(async () => undefined),
      },
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
  window.dispatchEvent(new Event("pagehide"));
  Reflect.deleteProperty(document, "visibilityState");
  if (typeof changed === "function")
    changed({ [ACTIVE_DRAFT_STORAGE_KEY]: { newValue: undefined } }, "session");
  vi.unstubAllGlobals();
});
describe("preview identity and event ordering", () => {
  it("loads without the retired Recapture control or a panel capture action", () => {
    expect(document.getElementById("recapture")).toBeNull();
    expect(send.mock.calls.some(([request]) => request.type === "CAPTURE_ACTIVE_TEXT")).toBe(false);
  });
  it("requires local acknowledgement even when cloud writing was already consented", () => {
    changed({ [LOCAL_READING_CONSENT_KEY]: { newValue: undefined } }, "local");
    emit({ ...ready(), source: "selection", autoTranslate: true });
    expect(document.getElementById("local-reading-notice")?.hidden).toBe(false);
    expect(document.getElementById("privacy-notice")?.hidden).toBe(true);
    expect(generationCalls()).toHaveLength(0);
    expect(localMock.translate).not.toHaveBeenCalled();
  });
  it("shows an explicit setup action without falling back to RUN_REWRITE", async () => {
    localMock.translate.mockRejectedValueOnce(new LocalTranslationError("SETUP_REQUIRED"));
    emit({ ...ready(), source: "selection", autoTranslate: true });
    await vi.waitFor(() => expect(button("local-translation-action").hidden).toBe(false));
    expect(button("local-translation-action").textContent).toBe("Enable local translation");
    expect(send.mock.calls.some(([request]) => request.type === "RUN_REWRITE")).toBe(false);
    button("local-translation-action").click();
    await vi.waitFor(() => expect(generationCalls()).toHaveLength(2));
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  it("cannot publish local output if worker completion is refused", async () => {
    const originalSend = send.getMockImplementation();
    if (!originalSend) throw new Error("Missing fixture message implementation");
    send.mockImplementation(async (request) =>
      request.type === "COMPLETE_LOCAL_TRANSLATION"
        ? { ok: false, code: "CANCELLED", message: "Reading session ended." }
        : await originalSend(request),
    );
    emit({ ...ready(), source: "selection", autoTranslate: true });
    finish(success());
    await vi.waitFor(() =>
      expect(document.getElementById("status")?.textContent).toBe("Reading session ended."),
    );
    expect(field("preview").value).toBe("");
  });
  it("translates the initial hidden capture when the panel first becomes visible", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    emit({ ...ready(), source: "selection", autoTranslate: true });
    expect(send).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attempt().settings.targetLanguage).toBe("vi");
    document.dispatchEvent(new Event("visibilitychange"));
    acknowledgeReading(READING_READY_MESSAGE);
    expect(generationCalls()).toHaveLength(1);
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  it("waits for worker readiness before consuming automatic translation intent", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    autoAcknowledge = false;
    emit({ ...ready(), source: "selection", autoTranslate: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    acknowledgeReading("invalid");
    expect(send).not.toHaveBeenCalled();
    acknowledgeReading(READING_READY_MESSAGE);
    expect(attempt().settings.targetLanguage).toBe("vi");
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  it("does not retry a failed initial translation when visibility changes again", async () => {
    emit({ ...ready(), source: "selection", autoTranslate: true });
    finish({ ok: false, code: "PROVIDER_ERROR", message: "Synthetic failure." });
    await vi.waitFor(() =>
      expect(document.getElementById("status")?.textContent).toBe(
        "Local translation failed. Please retry.",
      ),
    );
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { configurable: true, value });
      document.dispatchEvent(new Event("visibilitychange"));
    }
    expect(generationCalls()).toHaveLength(1);
  });
  it("ignores readiness from a disconnected port and starts only the current capture", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    autoAcknowledge = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    const staleReady = acknowledgeReading;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    emit({ ...ready("draft-B"), source: "selection", autoTranslate: true });
    staleReady(READING_READY_MESSAGE);
    expect(send).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    acknowledgeReading(READING_READY_MESSAGE);
    expect(attempt().snapshotId).toBe("draft-B");
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  async function translate(): Promise<void> {
    emit({ ...ready(), source: "selection", autoTranslate: true });
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  }
  it("collapses original text by default and keeps expansion until a new capture", async () => {
    await translate();
    expect(field("original").hidden).toBe(true);
    expect(button("original-toggle").getAttribute("aria-expanded")).toBe("false");
    button("original-toggle").click();
    expect(field("original").hidden).toBe(false);
    expect(button("original-toggle").getAttribute("aria-expanded")).toBe("true");
    emit({
      ...ready(),
      source: "selection",
      phase: "preview",
      generationId: attempt().generationId,
    });
    expect(field("original").hidden).toBe(false);
    emit({ ...ready("draft-B"), source: "selection" });
    expect(field("original").hidden).toBe(true);
    expect(button("original-toggle").getAttribute("aria-expanded")).toBe("false");
    emit(ready("writing-C"));
    expect(field("original").hidden).toBe(false);
    expect(button("original-toggle").hidden).toBe(true);
  });
  it("clears the source selection and stops its speech when original text is collapsed", async () => {
    await translate();
    button("original-toggle").click();
    field("original").setSelectionRange(0, 5);
    button("original-sound").click();
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledOnce());
    button("original-toggle").click();
    expect(field("original").hidden).toBe(true);
    expect(field("original").selectionStart).toBe(field("original").selectionEnd);
    expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
  });
  it("shows original and translation with sound icons and no automatic playback", async () => {
    await translate();
    expect(field("original").value).toBe("draft-A");
    expect(field("preview").hidden).toBe(false);
    expect(field("preview").readOnly).toBe(true);
    expect(document.getElementById("original-section")?.hidden).toBe(false);
    expect(button("original-sound").hidden).toBe(false);
    expect(button("translation-sound").hidden).toBe(false);
    expect(document.querySelector("#original-language")).toBeNull();
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    button("translation-sound").click();
    expect(vi.mocked(speechSynthesis.speak).mock.calls[0]?.[0]).toMatchObject({
      text: "Rewrite A",
      lang: "vi-VN",
      voice: { localService: true },
    });
    expect(button("translation-sound").getAttribute("aria-label")).toBe("Stop playback");
    button("translation-sound").click();
    expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
    expect(button("translation-sound").getAttribute("aria-label")).toBe("Listen to translation");
  });
  it("reads a selected translated phrase and preserves the selection when the icon is clicked", async () => {
    await translate();
    field("preview").setSelectionRange(0, 7);
    button("translation-sound").focus();
    button("translation-sound").click();
    expect(vi.mocked(speechSynthesis.speak).mock.calls[0]?.[0].text).toBe("Rewrite");
    expect(document.activeElement).toBe(field("preview"));
    expect(field("preview").selectionStart).toBe(0);
    expect(field("preview").selectionEnd).toBe(7);
  });
  it("keeps the speech selection after completion and stopping, and clears it on another click", async () => {
    await translate();
    field("preview").setSelectionRange(0, 7);
    button("translation-sound").click();
    const utterance = vi.mocked(speechSynthesis.speak).mock.calls[0]?.[0];
    utterance?.onend?.call(utterance, {} as SpeechSynthesisEvent);
    expect(field("preview").selectionEnd - field("preview").selectionStart).toBe(7);
    button("translation-sound").click();
    button("translation-sound").click();
    expect(document.activeElement).toBe(field("preview"));
    expect(field("preview").selectionEnd - field("preview").selectionStart).toBe(7);
    button("original-toggle").click();
    expect(field("preview").selectionEnd).toBe(field("preview").selectionStart);
  });
  it("preserves focus for pointer playback but releases selection when another field is clicked", async () => {
    await translate();
    field("preview").focus();
    field("preview").setSelectionRange(0, 7);
    const pointer = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    button("translation-sound").dispatchEvent(pointer);
    expect(pointer.defaultPrevented).toBe(true);
    button("translation-sound").click();
    select("language").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(field("preview").selectionEnd).toBe(field("preview").selectionStart);
  });
  it("clears the speech selection when focus leaves the panel", async () => {
    await translate();
    field("preview").setSelectionRange(0, 7);
    button("translation-sound").click();
    window.dispatchEvent(new Event("blur"));
    expect(field("preview").selectionEnd).toBe(field("preview").selectionStart);
  });
  it("keeps the original highlight when the translation result arrives for the same capture", async () => {
    emit({ ...ready(), source: "selection", autoTranslate: true });
    button("original-toggle").click();
    field("original").setSelectionRange(0, 5);
    button("original-sound").click();
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledOnce());
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
    expect(field("original").selectionStart).toBe(0);
    expect(field("original").selectionEnd).toBe(5);
    expect(document.activeElement).toBe(field("original"));
  });
  it("detects the original language using the complete captured text and reads its selection", async () => {
    await translate();
    field("original").setSelectionRange(0, 5);
    const calls = send.mock.calls.length;
    button("original-sound").click();
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledOnce());
    expect(chrome.i18n.detectLanguage).toHaveBeenCalledWith("draft-A");
    expect(vi.mocked(speechSynthesis.speak).mock.calls[0]?.[0]).toMatchObject({
      text: "draft",
      lang: "fr-FR",
    });
    expect(send.mock.calls).toHaveLength(calls);
  });
  it("reads the whole original when nothing is selected and switches playback between icons", async () => {
    await translate();
    button("translation-sound").click();
    button("original-sound").click();
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledTimes(2));
    expect(vi.mocked(speechSynthesis.speak).mock.calls[1]?.[0].text).toBe("draft-A");
    expect(button("translation-sound").getAttribute("aria-label")).toBe("Listen to translation");
    expect(button("original-sound").getAttribute("aria-label")).toBe("Stop playback");
  });
  it.each(["hide", "close", "capture", "language", "consent", "clear"])(
    "stops speech when lifecycle changes: %s",
    async (action) => {
      await translate();
      button("translation-sound").click();
      if (action === "hide") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else if (action === "close") window.dispatchEvent(new Event("pagehide"));
      else if (action === "capture") emit({ ...ready("draft-B"), source: "selection" });
      else if (action === "language") {
        select("language").value = "fr";
        select("language").dispatchEvent(new Event("change"));
        finish(success());
      } else if (action === "consent")
        changed({ [LOCAL_READING_CONSENT_KEY]: { newValue: undefined } }, "local");
      else button("clear-private-data").click();
      expect(speechSynthesis.cancel).toHaveBeenCalled();
      expect(button("translation-sound").getAttribute("aria-label")).toBe("Listen to translation");
    },
  );
  it.each(["stop", "hide", "capture", "translation", "clear"])(
    "discards delayed source-language detection after %s",
    async (action) => {
      await translate();
      let resolveDetection: (value: {
        isReliable: boolean;
        languages: { language: string; percentage: number }[];
      }) => void = () => {
        throw new Error("Missing detection");
      };
      detect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDetection = resolve;
          }),
      );
      button("original-sound").click();
      if (action === "stop") button("original-sound").click();
      else if (action === "hide") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else if (action === "capture") emit({ ...ready("draft-B"), source: "selection" });
      else if (action === "translation") button("translation-sound").click();
      else button("clear-private-data").click();
      resolveDetection({ isReliable: true, languages: [{ language: "fr", percentage: 100 }] });
      await Promise.resolve();
      await Promise.resolve();
      expect(
        vi
          .mocked(speechSynthesis.speak)
          .mock.calls.some(([utterance]) => utterance.lang === "fr-FR"),
      ).toBe(false);
    },
  );
  it("reports unknown source language without using a default voice", async () => {
    await translate();
    detect.mockResolvedValue({
      isReliable: false,
      languages: [{ language: "und", percentage: 100 }],
    });
    button("original-sound").click();
    await vi.waitFor(() =>
      expect(document.getElementById("speech-status")?.textContent).toContain("Could not identify"),
    );
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(button("original-sound").getAttribute("aria-label")).toBe("Listen to original");
  });
  it("bounds source-language detection and resets the icon on failure", async () => {
    await translate();
    vi.useFakeTimers();
    try {
      detect.mockImplementation(() => new Promise(() => {}));
      button("original-sound").click();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(speechSynthesis.speak).not.toHaveBeenCalled();
      expect(document.getElementById("speech-status")?.textContent).toContain("Could not identify");
      expect(button("original-sound").getAttribute("aria-label")).toBe("Listen to original");
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps model markup as literal textarea text", async () => {
    emit({ ...ready(), source: "selection", autoTranslate: true });
    const response = success();
    if (!response.ok || !("rewrite" in response)) throw new Error("Invalid fixture");
    response.rewrite.rewrittenText = '<img src=x onerror="alert(1)">';
    finish(response);
    await vi.waitFor(() => expect(field("preview").value).toBe(response.rewrite.rewrittenText));
    expect(document.querySelector("#result img")).toBeNull();
  });
  it("shows a helpful error when no local voice is installed", async () => {
    await translate();
    vi.mocked(speechSynthesis.getVoices).mockReturnValue([]);
    button("translation-sound").click();
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(document.getElementById("speech-status")?.textContent).toContain("No local voice");
    expect(document.getElementById("voice-install")?.hidden).toBe(false);
    expect(document.getElementById("voice-install-instructions")?.textContent).toContain(
      "Vietnamese",
    );
    vi.mocked(speechSynthesis.getVoices).mockReturnValue([
      { lang: "vi-VN", localService: true } as SpeechSynthesisVoice,
    ]);
    button("translation-sound").click();
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
    expect(document.getElementById("voice-install")?.hidden).toBe(true);
  });
  it("offers Windows settings only on Windows and clears installation help on capture changes", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
    await translate();
    vi.mocked(speechSynthesis.getVoices).mockReturnValue([]);
    button("translation-sound").click();
    const link = document.getElementById("voice-settings") as HTMLAnchorElement;
    expect(link.hidden).toBe(false);
    expect(link.getAttribute("href")).toBe("ms-settings:speech");
    expect(document.getElementById("voice-install-instructions")?.textContent).toContain(
      "Add voices",
    );
    emit({ ...ready("new-capture"), source: "selection" });
    expect(document.getElementById("voice-install")?.hidden).toBe(true);
  });
  it("stops speech and clears both text areas when the capture expires", async () => {
    await translate();
    vi.useFakeTimers();
    try {
      const state = ready();
      state.draft.expiresAt = Date.now() + 100;
      emit({ ...state, source: "selection" });
      button("translation-sound").click();
      expect(speechSynthesis.speak).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(100);
      expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
      expect(field("preview").value).toBe("");
      expect(field("original").value).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
  it("never starts queued translations or delayed captures after hiding the panel", async () => {
    emit({ ...ready(), source: "selection", autoTranslate: true });
    const initialReply = finish;
    const initialRequest = attempt();
    emit({
      ...ready(),
      source: "selection",
      phase: "generating",
      generationId: initialRequest.generationId,
    });
    select("language").value = "fr";
    select("language").dispatchEvent(new Event("change"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    emit({ ...ready(), source: "selection" });
    initialReply({ ok: false, code: "CANCELLED", message: "Panel hidden." });
    await vi.waitFor(() => expect(button("generate").disabled).toBe(false));
    emit({ ...ready("late-capture"), source: "selection", autoTranslate: true });
    expect(generationCalls()).toHaveLength(1);
  });
  it("does not lose consent accepted while the initial preferences are still loading", async () => {
    changed({ [ACTIVE_DRAFT_STORAGE_KEY]: { newValue: undefined } }, "session");
    vi.resetModules();
    let resolveLocal: (value: Record<string, string>) => void = () => {
      throw new Error("Missing storage read");
    };
    vi.mocked(chrome.storage.local.get).mockImplementation(
      () =>
        new Promise<Record<string, string>>((resolve) => {
          resolveLocal = resolve;
        }),
    );
    await import("./sidepanel.js");
    emit({ ...ready(), source: "selection", autoTranslate: true });
    button("accept-local-reading").click();
    await vi.waitFor(() => expect(document.getElementById("privacy-notice")?.hidden).toBe(true));
    expect(generationCalls()).toHaveLength(0);
    resolveLocal({ translationLanguage: "vi" });
    await vi.waitFor(() => expect(attempt().settings.targetLanguage).toBe("vi"));
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  it("translates a context-menu capture once without pressing Translate", async () => {
    const state: ReadyDraftState = { ...ready(), source: "selection", autoTranslate: true };
    emit(state);
    expect(attempt().settings).toEqual({ operation: "translate", targetLanguage: "vi" });
    emit(state);
    expect(generationCalls()).toHaveLength(1);
    finish({ ok: false, code: "PROVIDER_ERROR", message: "Try again." });
    await vi.waitFor(() => expect(button("generate").disabled).toBe(false));
    emit(state);
    expect(generationCalls()).toHaveLength(1);
  });
  it("waits for consent then immediately translates the context-menu selection", async () => {
    changed({ [LOCAL_READING_CONSENT_KEY]: { newValue: undefined } }, "local");
    emit({ ...ready(), source: "selection", autoTranslate: true });
    expect(send).not.toHaveBeenCalled();
    button("accept-local-reading").click();
    await vi.waitFor(() => expect(attempt().settings.targetLanguage).toBe("vi"));
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  it("waits for saved language before starting an early context-menu capture", async () => {
    changed({ [ACTIVE_DRAFT_STORAGE_KEY]: { newValue: undefined } }, "session");
    vi.resetModules();
    let resolveLocal: (value: Record<string, string>) => void = () => {
      throw new Error("Missing storage read");
    };
    vi.mocked(chrome.storage.local.get).mockImplementation(
      () =>
        new Promise<Record<string, string>>((resolve) => {
          resolveLocal = resolve;
        }),
    );
    await import("./sidepanel.js");
    emit({ ...ready(), source: "selection", autoTranslate: true });
    expect(send).not.toHaveBeenCalled();
    resolveLocal({
      [PRIVACY_CONSENT_KEY]: consentScope(apiUrl),
      [LOCAL_READING_CONSENT_KEY]: LOCAL_READING_NOTICE_VERSION,
      translationLanguage: "fr",
    });
    await vi.waitFor(() => expect(attempt().settings.targetLanguage).toBe("fr"));
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  it.each([false, true])(
    "restores saved language after an early capture without overriding user choice (edited=%s)",
    async (edited) => {
      changed({ [ACTIVE_DRAFT_STORAGE_KEY]: { newValue: undefined } }, "session");
      vi.resetModules();
      let resolveLocal: (value: Record<string, string>) => void = () => {
        throw new Error("Storage read not started");
      };
      vi.mocked(chrome.storage.local.get).mockImplementation(
        () =>
          new Promise<Record<string, string>>((resolve) => {
            resolveLocal = resolve;
          }),
      );
      await import("./sidepanel.js");
      emit({ ...ready(), source: "selection" });
      if (edited) {
        select("language").value = "de";
        select("language").dispatchEvent(new Event("change"));
      }
      resolveLocal({
        [PRIVACY_CONSENT_KEY]: consentScope(apiUrl),
        [LOCAL_READING_CONSENT_KEY]: LOCAL_READING_NOTICE_VERSION,
        translationLanguage: "fr",
      });
      await vi.waitFor(() => expect(select("language").value).toBe(edited ? "de" : "fr"));
    },
  );
  it("shows original and translation without writing mode, Copy or Replace", async () => {
    emit({ ...ready(), source: "selection" });
    expect(document.getElementById("original-section")?.hidden).toBe(false);
    expect(field("original").value).toBe("draft-A");
    expect(document.getElementById("mode-option")?.hidden).toBe(true);
    expect(button("copy").hidden).toBe(true);
    expect(button("replace").hidden).toBe(true);
    expect(button("generate").hidden).toBe(true);
    expect(select("language").value).toBe("vi");
    select("language").dispatchEvent(new Event("change"));
    expect(attempt().settings).toEqual({ operation: "translate", targetLanguage: "vi" });
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
    expect(field("preview").readOnly).toBe(true);
    expect(document.getElementById("status")?.textContent).toBe(
      "Translation ready on this device.",
    );
    emit(ready("draft-B"));
    expect(button("generate").hidden).toBe(false);
    expect(button("copy").hidden).toBe(false);
    expect(document.getElementById("original-section")?.hidden).toBe(false);
    expect(select("language").value).toBe("same");
  });
  it("remembers the translation language between selections", () => {
    emit({ ...ready(), source: "selection" });
    select("language").value = "fr";
    select("language").dispatchEvent(new Event("change"));
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ translationLanguage: "fr" });
    emit({ ...ready("draft-B"), source: "selection" });
    expect(select("language").value).toBe("fr");
  });
  it("translates a language change without pressing a button", async () => {
    emit({ ...ready(), source: "selection" });
    select("language").value = "fr";
    select("language").dispatchEvent(new Event("change"));
    expect(attempt().settings).toEqual({ operation: "translate", targetLanguage: "fr" });
    finish(success());
    await vi.waitFor(() => expect(field("preview").value).toBe("Rewrite A"));
  });
  it("coalesces rapid language changes and discards the earlier language result", async () => {
    emit({ ...ready(), source: "selection", autoTranslate: true });
    const first = attempt();
    const firstReply = finish;
    emit({
      ...ready(),
      source: "selection",
      phase: "generating",
      generationId: first.generationId,
    });
    for (const target of ["fr", "de"]) {
      select("language").value = target;
      select("language").dispatchEvent(new Event("change"));
    }
    expect(generationCalls()).toHaveLength(1);
    firstReply(success());
    await vi.waitFor(() => expect(button("generate").disabled).toBe(true));
    emit({ ...ready(), source: "selection", phase: "preview", generationId: first.generationId });
    await vi.waitFor(() => expect(generationCalls()).toHaveLength(2));
    expect(field("preview").value).toBe("");
    const second = generationCalls()[1];
    if (second?.type !== "RUN_REWRITE") throw new Error("Missing latest translation");
    expect(second.settings.targetLanguage).toBe("de");
    finish({
      ok: true,
      snapshotId: second.snapshotId,
      generationId: second.generationId,
      rewrite: { rewrittenText: "Deutsch", model: "fake", requestId: "second" },
    });
    await vi.waitFor(() => expect(field("preview").value).toBe("Deutsch"));
  });
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
