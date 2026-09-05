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

async function loadWorker(initial?: unknown) {
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
  settings: { operation: "rephrase", tone: "natural", targetLanguage: "same" },
};

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
