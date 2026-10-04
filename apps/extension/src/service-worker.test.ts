import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_DRAFT_STORAGE_KEY,
  consentScope,
  EXPIRY_ALARM,
  type ExtensionRequest,
  type ExtensionResponse,
  PRIVACY_CONSENT_KEY,
  type ReadyDraftState,
  SNAPSHOT_TTL_MS,
  READING_READY_MESSAGE,
} from "./messages.js";

const API_URL = "http://127.0.0.1:8787";
const EXTENSION_ID = "synthetic-extension";
const EXTENSION_URL = `chrome-extension://${EXTENSION_ID}/`;
type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
type AlarmListener = Parameters<typeof chrome.alarms.onAlarm.addListener>[0];

function readyDraft(): ReadyDraftState {
  return {
    status: "ready",
    phase: "captured",
    tabId: 7,
    documentId: "document-a",
    draft: {
      snapshotId: "snapshot-a",
      text: "Synthetic draft",
      richText: false,
      expiresAt: Date.now() + SNAPSHOT_TTL_MS,
    },
  };
}

function storageArea(values: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) =>
      Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {},
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    }),
  };
}

async function loadWorker(initial?: unknown, betaApiToken = "") {
  const sessionValues: Record<string, unknown> =
    initial === undefined ? {} : { [ACTIVE_DRAFT_STORAGE_KEY]: structuredClone(initial) };
  const localValues: Record<string, unknown> = {
    [PRIVACY_CONSENT_KEY]: consentScope(API_URL),
  };
  const browser = {
    storage: { session: storageArea(sessionValues), local: storageArea(localValues) },
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => EXTENSION_URL + path,
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn<(listener: MessageListener) => void>() },
      onConnect: { addListener: vi.fn() },
    },
    action: { onClicked: { addListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn() } },
    contextMenus: {
      onClicked: { addListener: vi.fn() },
      removeAll: vi.fn(async () => undefined),
      create: vi.fn(),
    },
    alarms: {
      onAlarm: { addListener: vi.fn<(listener: AlarmListener) => void>() },
      clear: vi.fn(async () => true),
      create: vi.fn(async () => undefined),
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(
        async (..._args: unknown[]): Promise<unknown> => ({ ok: true, cleared: true }),
      ),
    },
    scripting: { executeScript: vi.fn(async () => [{ frameId: 0, documentId: "document-a" }]) },
    sidePanel: { open: vi.fn(async () => undefined) },
  };
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("chrome", browser);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("__SMARTASSISTANCE_API_BASE_URL__", API_URL);
  vi.stubGlobal("__SMARTASSISTANCE_BETA_API_TOKEN__", betaApiToken);
  await import("./service-worker.js");
  // Startup uses only immediately resolved storage mocks; drain its transitions.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const messageListener = browser.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const alarmListener = browser.alarms.onAlarm.addListener.mock.calls[0]?.[0];
  if (!messageListener || !alarmListener) throw new Error("Missing worker listeners");

  function send(
    message: unknown,
    sender: chrome.runtime.MessageSender = {
      id: EXTENSION_ID,
      url: `${EXTENSION_URL}sidepanel.html`,
    },
  ): Promise<ExtensionResponse> {
    if (!messageListener) throw new Error("Missing message listener");
    return new Promise((resolve) => messageListener(message, sender, resolve));
  }
  function fireExpiryAlarm(): void {
    if (!alarmListener) throw new Error("Missing alarm listener");
    alarmListener({ name: EXPIRY_ALARM, scheduledTime: Date.now(), persistAcrossSessions: false });
  }
  return { browser, sessionValues, localValues, fetchMock, send, fireExpiryAlarm };
}

const runRequest: ExtensionRequest = {
  type: "RUN_REWRITE",
  snapshotId: "snapshot-a",
  generationId: "generation-a",
  settings: { operation: "improve", tone: "natural", targetLanguage: "same" },
};

function connectReader(
  browser: Awaited<ReturnType<typeof loadWorker>>["browser"],
  url = `${EXTENSION_URL}sidepanel.html`,
) {
  const port = {
    name: "active-reading",
    sender: { id: EXTENSION_ID, url },
    disconnect: vi.fn(),
    postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn() },
  };
  const connect = browser.runtime.onConnect.addListener.mock.calls[0]?.[0];
  if (!connect) throw new Error("Missing reading port listener");
  connect(port);
  return { port, close: () => port.onDisconnect.addListener.mock.calls[0]?.[0]() };
}

function pendingFetch(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): AbortSignal[] {
  const signals: AbortSignal[] = [];
  fetchMock.mockImplementation((_url, options) => {
    const signal = options?.signal;
    if (!signal) throw new Error("Expected cancellation signal");
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  return signals;
}

describe("service worker private state and request boundaries", () => {
  it("acknowledges readiness only for authenticated panel connections", async () => {
    const { browser } = await loadWorker();
    const valid = connectReader(browser);
    expect(valid.port.postMessage).toHaveBeenCalledWith(READING_READY_MESSAGE);
    const invalid = connectReader(browser, "https://example.invalid/article");
    expect(invalid.port.disconnect).toHaveBeenCalledOnce();
    expect(invalid.port.postMessage).not.toHaveBeenCalled();
  });
  it("discards a delayed capture when the user switches tabs", async () => {
    const initial = { ...readyDraft(), source: "selection" as const };
    const { browser, send, sessionValues } = await loadWorker(initial);
    connectReader(browser);
    let reply: (value: unknown) => void = () => {
      throw new Error("Missing capture");
    };
    browser.tabs.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const result = send({ type: "READ_SELECTION" });
    await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
    browser.tabs.query.mockResolvedValue([{ id: 8 }]);
    reply({ ok: true, draft: { ...readyDraft().draft, snapshotId: "new", text: "New passage" } });
    expect(await result).toEqual({ ok: true, unchanged: true });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toEqual(initial);
  });
  it("does not translate an inactive source tab", async () => {
    const { browser, send, fetchMock } = await loadWorker({ ...readyDraft(), source: "selection" });
    connectReader(browser);
    browser.tabs.query.mockResolvedValue([{ id: 8 }]);
    expect(
      await send({ ...runRequest, settings: { operation: "translate", targetLanguage: "vi" } }),
    ).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not transmit selected text without a connected panel", async () => {
    const { send, fetchMock } = await loadWorker({ ...readyDraft(), source: "selection" });
    expect(
      await send({ ...runRequest, settings: { operation: "translate", targetLanguage: "vi" } }),
    ).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not replace a writing session with a stale article selection", async () => {
    const initial = readyDraft();
    const { browser, send, sessionValues } = await loadWorker(initial);
    connectReader(browser);
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toEqual(initial);
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it("accepts the first passage selected after opening an empty page", async () => {
    const { browser, send, sessionValues } = await loadWorker();
    browser.tabs.sendMessage
      .mockResolvedValueOnce({ ok: true, empty: true })
      .mockResolvedValueOnce({ ok: false, code: "INVALID_REQUEST", message: "No editor." });
    expect(await send({ type: "CAPTURE_ACTIVE_TEXT" })).toMatchObject({ ok: false });
    connectReader(browser);
    browser.tabs.sendMessage.mockResolvedValue({ ok: true, draft: readyDraft().draft });
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, captured: true });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toMatchObject({
      source: "selection",
      autoTranslate: true,
    });
  });
  it("requires a visible reader and consent before reading page selections", async () => {
    const { browser, send, localValues } = await loadWorker(readyDraft());
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
    const reader = connectReader(browser);
    delete localValues[PRIVACY_CONSENT_KEY];
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    reader.close();
  });
  it("rejects reading connections from page content", async () => {
    const { browser, send } = await loadWorker(readyDraft());
    const reader = connectReader(browser, "https://example.invalid/article");
    expect(reader.port.disconnect).toHaveBeenCalled();
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it("captures new text once, ignores other tabs, and stops after panel closure", async () => {
    const { browser, send, sessionValues, fetchMock } = await loadWorker({
      ...readyDraft(),
      source: "selection",
    });
    const reader = connectReader(browser);
    browser.tabs.query.mockResolvedValueOnce([{ id: 8 }]);
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    browser.tabs.sendMessage.mockResolvedValue({
      ok: true,
      draft: { ...readyDraft().draft, snapshotId: "new-selection", text: "New synthetic passage" },
    });
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, captured: true });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toMatchObject({
      source: "selection",
      autoTranslate: true,
      draft: { text: "New synthetic passage" },
    });
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
    reader.close();
    const count = browser.tabs.sendMessage.mock.calls.length;
    expect(await send({ type: "READ_SELECTION" })).toEqual({ ok: true, unchanged: true });
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(count);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("aborts a translation when the last reading panel disconnects", async () => {
    const { browser, send, fetchMock } = await loadWorker({ ...readyDraft(), source: "selection" });
    const reader = connectReader(browser);
    const signals = pendingFetch(fetchMock);
    const response = send({
      ...runRequest,
      settings: { operation: "translate", targetLanguage: "vi" },
    });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    reader.close();
    expect(await response).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(signals[0]?.aborted).toBe(true);
  });
  it("marks context-menu translation for immediate generation and targets the clicked frame", async () => {
    const { browser, sessionValues, fetchMock } = await loadWorker();
    browser.scripting.executeScript.mockResolvedValueOnce([
      { frameId: 4, documentId: "selected-frame" },
    ]);
    browser.tabs.sendMessage.mockResolvedValueOnce({ ok: true, draft: readyDraft().draft });
    const listener = browser.contextMenus.onClicked.addListener.mock.calls[0]?.[0];
    listener({ menuItemId: "smartassistance-translate", frameId: 4 }, { id: 7 });
    expect(browser.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
    await vi.waitFor(() =>
      expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toMatchObject({
        source: "selection",
        autoTranslate: true,
        documentId: "selected-frame",
      }),
    );
    expect(browser.scripting.executeScript).toHaveBeenCalledWith({
      files: ["content-script.js"],
      target: { tabId: 7, frameIds: [4] },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("consumes automatic intent before a failed request so reopening never retries automatically", async () => {
    const { browser, sessionValues, send, fetchMock } = await loadWorker({
      ...readyDraft(),
      source: "selection",
      autoTranslate: true,
    });
    connectReader(browser);
    fetchMock.mockRejectedValueOnce(new Error("Synthetic network failure"));
    expect(
      await send({ ...runRequest, settings: { operation: "translate", targetLanguage: "vi" } }),
    ).toMatchObject({ ok: false });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toMatchObject({
      phase: "captured",
      source: "selection",
    });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).not.toHaveProperty("autoTranslate");
  });
  it("captures selection before editor when invoked through the toolbar flow", async () => {
    const { browser, send, sessionValues, fetchMock } = await loadWorker();
    const draft = readyDraft().draft;
    browser.tabs.sendMessage.mockResolvedValueOnce({ ok: true, draft });
    expect(await send({ type: "CAPTURE_ACTIVE_TEXT" })).toEqual({ ok: true, captured: true });
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { type: "CAPTURE_SELECTION" },
      { documentId: "document-a" },
    );
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toMatchObject({ source: "selection", draft });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("falls back to the editor only when there is no selected text", async () => {
    const { browser, send, sessionValues } = await loadWorker();
    browser.tabs.sendMessage
      .mockResolvedValueOnce({ ok: true, empty: true })
      .mockResolvedValueOnce({ ok: true, draft: readyDraft().draft });
    expect(await send({ type: "CAPTURE_ACTIVE_TEXT" })).toEqual({ ok: true, captured: true });
    expect(browser.tabs.sendMessage).toHaveBeenLastCalledWith(
      7,
      { type: "CAPTURE_FOCUSED_EDITOR" },
      { documentId: "document-a" },
    );
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).not.toHaveProperty("source");
  });
  it("never falls back to an entire editor when the selection is rejected", async () => {
    const { browser, send, fetchMock } = await loadWorker();
    browser.tabs.sendMessage.mockResolvedValueOnce({
      ok: false,
      code: "INVALID_REQUEST",
      message: "Select a shorter passage.",
    });
    expect(await send({ type: "CAPTURE_ACTIVE_TEXT" })).toMatchObject({ ok: false });
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("translates only the captured selection and refuses replacement", async () => {
    const state: ReadyDraftState = { ...readyDraft(), source: "selection" };
    const { browser, send, fetchMock } = await loadWorker(state);
    connectReader(browser);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ rewrittenText: "Traduction", model: "fake", requestId: "synthetic" }),
      ),
    );
    expect(
      await send({ ...runRequest, settings: { operation: "translate", targetLanguage: "fr" } }),
    ).toMatchObject({ ok: true });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      text: state.draft.text,
      operation: "translate",
      targetLanguage: "fr",
    });
    expect(
      await send({
        type: "APPLY_ACTIVE_REWRITE",
        snapshotId: "snapshot-a",
        generationId: "generation-a",
        text: "Traduction",
      }),
    ).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it("requires consent for selected text and disallows writing modes", async () => {
    const { send, localValues, fetchMock } = await loadWorker({
      ...readyDraft(),
      source: "selection",
    });
    expect(await send(runRequest)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    delete localValues[PRIVACY_CONSENT_KEY];
    expect(
      await send({ ...runRequest, settings: { operation: "translate", targetLanguage: "fr" } }),
    ).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { status: "ready", tabId: 7, draft: { snapshotId: "legacy", text: "Synthetic legacy draft" } },
    { status: "ready", draft: "Synthetic malformed draft" },
    { status: "capturing", draft: { text: "Synthetic legacy draft" } },
    { status: "error", message: "failed", draft: { text: "Synthetic legacy draft" } },
    null,
  ])("removes incompatible private state and its alarm on startup: %j", async (legacy) => {
    const { browser, sessionValues, fetchMock } = await loadWorker(legacy);
    expect(sessionValues).not.toHaveProperty(ACTIVE_DRAFT_STORAGE_KEY);
    expect(browser.storage.session.remove).toHaveBeenCalledWith(ACTIVE_DRAFT_STORAGE_KEY);
    expect(browser.alarms.clear).toHaveBeenCalledWith(EXPIRY_ALARM);
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a valid unexpired capture on startup", async () => {
    const state = readyDraft();
    const { browser, sessionValues, fetchMock } = await loadWorker(state);
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toEqual(state);
    expect(browser.storage.session.remove).not.toHaveBeenCalled();
    expect(browser.storage.session.set).not.toHaveBeenCalled();
    expect(browser.alarms.clear).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears a content-script snapshot when capture-state setup fails", async () => {
    const { browser, send, sessionValues } = await loadWorker();
    const draft = readyDraft().draft;
    browser.tabs.sendMessage.mockResolvedValueOnce({ ok: true, draft });
    browser.alarms.create.mockRejectedValueOnce(new Error("Synthetic alarm failure"));

    expect(await send({ type: "CAPTURE_ACTIVE_EDITOR" })).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
    expect(browser.tabs.sendMessage).toHaveBeenLastCalledWith(
      7,
      { type: "CLEAR_SNAPSHOT", snapshotId: draft.snapshotId },
      { documentId: "document-a" },
    );
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toMatchObject({ status: "error" });
  });

  it("captures a focused editor in an injectable child frame", async () => {
    const { browser, send, sessionValues } = await loadWorker();
    const draft = readyDraft().draft;
    browser.scripting.executeScript.mockResolvedValueOnce([
      { frameId: 0, documentId: "document-top" },
      { frameId: 4, documentId: "document-compose" },
    ]);
    browser.tabs.sendMessage.mockImplementation(async (...args: unknown[]): Promise<unknown> => {
      const [request, options] = args.slice(1);
      if ((request as { type?: string }).type !== "CAPTURE_FOCUSED_EDITOR")
        return { ok: true, cleared: true };
      return (options as { documentId: string }).documentId === "document-compose"
        ? { ok: true, draft }
        : { ok: false, code: "INVALID_REQUEST", message: "No focused editor." };
    });

    expect(await send({ type: "CAPTURE_ACTIVE_EDITOR" })).toEqual({ ok: true, captured: true });
    expect(browser.scripting.executeScript).toHaveBeenCalledWith({
      files: ["content-script.js"],
      target: { tabId: 7, allFrames: true },
    });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toMatchObject({
      status: "ready",
      documentId: "document-compose",
      draft,
    });
  });

  it("recovers a generation interrupted by worker shutdown as a capture", async () => {
    const state = readyDraft();
    const { sessionValues, fetchMock } = await loadWorker({
      ...state,
      phase: "generating",
      generationId: "lost-generation",
    });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toEqual(state);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears an expired capture and its document snapshot on startup", async () => {
    const state = readyDraft();
    state.draft.expiresAt = Date.now() - 1;
    const { browser, sessionValues } = await loadWorker(state);
    expect(sessionValues).not.toHaveProperty(ACTIVE_DRAFT_STORAGE_KEY);
    expect(browser.alarms.clear).toHaveBeenCalledWith(EXPIRY_ALARM);
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      state.tabId,
      { type: "CLEAR_SNAPSHOT", snapshotId: state.draft.snapshotId },
      { documentId: state.documentId },
    );
  });

  it.each([
    { ...runRequest, settings: { ...runRequest.settings, text: "Uncaptured synthetic text" } },
    {
      type: "APPLY_ACTIVE_REWRITE",
      snapshotId: "snapshot-a",
      generationId: "generation-a",
      text: null,
    },
    { type: "CANCEL_REWRITE", snapshotId: "snapshot-a" },
  ])("rejects malformed requests before storage, browser, or network work: %j", async (message) => {
    const { browser, fetchMock, send } = await loadWorker(readyDraft());
    vi.clearAllMocks();
    expect(await send(message)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(browser.storage.session.get).not.toHaveBeenCalled();
    expect(browser.storage.session.set).not.toHaveBeenCalled();
    expect(browser.storage.local.get).not.toHaveBeenCalled();
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects page-originated requests before executing work", async () => {
    const { browser, send, fetchMock } = await loadWorker(readyDraft());
    browser.storage.session.get.mockClear();
    expect(await send(runRequest, { id: EXTENSION_ID, url: "https://example.com/" })).toMatchObject(
      {
        ok: false,
        code: "AUTHENTICATION_REQUIRED",
      },
    );
    expect(browser.storage.session.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires consent before sending a captured draft", async () => {
    const { browser, send, fetchMock, localValues } = await loadWorker(readyDraft());
    delete localValues[PRIVACY_CONSENT_KEY];
    expect(await send(runRequest)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    expect(browser.storage.session.set).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the beta build token when no user token is present", async () => {
    const { fetchMock, send } = await loadWorker(readyDraft(), "synthetic-beta-token");
    const signals = pendingFetch(fetchMock);
    const rewrite = send(runRequest);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer synthetic-beta-token",
    });
    await send({
      type: "CANCEL_REWRITE",
      snapshotId: "snapshot-a",
      generationId: "generation-a",
    });
    expect(signals[0]?.aborted).toBe(true);
    await rewrite;
  });

  it("cancels only the generation belonging to the requested snapshot and attempt", async () => {
    const state = readyDraft();
    const { fetchMock, send, sessionValues } = await loadWorker(state);
    const signals = pendingFetch(fetchMock);
    const rewrite = send(runRequest);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(
      await send({
        type: "CANCEL_REWRITE",
        snapshotId: "snapshot-a",
        generationId: "old-generation",
      }),
    ).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
    expect(
      await send({
        type: "CANCEL_REWRITE",
        snapshotId: "old-snapshot",
        generationId: "generation-a",
      }),
    ).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
    expect(signals[0]?.aborted).toBe(false);
    expect(
      await send({
        type: "CANCEL_REWRITE",
        snapshotId: "snapshot-a",
        generationId: "generation-a",
      }),
    ).toEqual({
      ok: true,
      cancelled: true,
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(await rewrite).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(sessionValues[ACTIVE_DRAFT_STORAGE_KEY]).toEqual(state);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts active generation when incompatible stored state is discovered", async () => {
    const { browser, fetchMock, send, sessionValues, fireExpiryAlarm } = await loadWorker(
      readyDraft(),
    );
    const signals = pendingFetch(fetchMock);
    const rewrite = send(runRequest);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    sessionValues[ACTIVE_DRAFT_STORAGE_KEY] = { status: "ready", draft: "Synthetic corrupt draft" };
    fireExpiryAlarm();

    expect(await rewrite).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(signals[0]?.aborted).toBe(true);
    expect(sessionValues).not.toHaveProperty(ACTIVE_DRAFT_STORAGE_KEY);
    expect(browser.alarms.clear).toHaveBeenCalledWith(EXPIRY_ALARM);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
