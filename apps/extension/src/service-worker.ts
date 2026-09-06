import {
  type ApiErrorCode,
  isApiErrorResponse,
  isRewriteResponse,
} from "@smartassistance/contracts";
import {
  ACTIVE_DRAFT_STORAGE_KEY,
  type ActiveDraftState,
  AUTH_TOKEN_STORAGE_KEY,
  type ContentScriptRequest,
  type ContentScriptResponse,
  consentScope,
  EXPIRY_ALARM,
  type ExtensionRequest,
  type ExtensionResponse,
  isActiveDraftState,
  isContentScriptResponse,
  isExtensionRequest,
  PRIVACY_CONSENT_KEY,
  type ReadyDraftState,
} from "./messages.js";

declare const __SMARTASSISTANCE_API_BASE_URL__: string;
declare const __SMARTASSISTANCE_BETA_API_TOKEN__: string;
const API_TIMEOUT_MS = 20_000;
const CONTEXT_MENU_ID = "smartassistance-rewrite";
let pending: { controller: AbortController; generationId: string; snapshotId: string } | undefined;
let mutation: Promise<unknown> = Promise.resolve();

// Serialize only local state transitions, never the provider wait.
function locked<T>(action: () => Promise<T>): Promise<T> {
  const next = mutation.then(action, action);
  mutation = next.catch(() => undefined);
  return next;
}
function failure(code: ApiErrorCode, message: string): ExtensionResponse {
  return { ok: false, code, message };
}
async function readState(): Promise<ActiveDraftState | undefined> {
  const stored = await chrome.storage.session.get(ACTIVE_DRAFT_STORAGE_KEY);
  const value: unknown = stored[ACTIVE_DRAFT_STORAGE_KEY];
  if (isActiveDraftState(value)) return value;
  if (Object.hasOwn(stored, ACTIVE_DRAFT_STORAGE_KEY)) {
    // Old or corrupt state can still contain private text and may have no expiry.
    pending?.controller.abort();
    pending = undefined;
    await chrome.storage.session.remove(ACTIVE_DRAFT_STORAGE_KEY);
    await chrome.alarms.clear(EXPIRY_ALARM);
  }
  return undefined;
}
async function setState(state: ActiveDraftState): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_DRAFT_STORAGE_KEY]: state });
}
async function sendToEditor(
  state: Pick<ReadyDraftState, "tabId" | "documentId">,
  request: ContentScriptRequest,
): Promise<ContentScriptResponse> {
  const value: unknown = await chrome.tabs.sendMessage(state.tabId, request, {
    documentId: state.documentId,
  });
  if (!isContentScriptResponse(value)) throw new Error("Invalid editor response.");
  return value;
}
async function clearState(): Promise<void> {
  pending?.controller.abort();
  pending = undefined;
  const state = await readState();
  await chrome.storage.session.remove(ACTIVE_DRAFT_STORAGE_KEY);
  await chrome.alarms.clear(EXPIRY_ALARM);
  if (state?.status === "ready") {
    try {
      await sendToEditor(state, { type: "CLEAR_SNAPSHOT", snapshotId: state.draft.snapshotId });
    } catch {
      /* A navigated document is already inaccessible. */
    }
  }
}
async function readyState(): Promise<ReadyDraftState | undefined> {
  const state = await readState();
  if (state?.status !== "ready") return undefined;
  if (state.draft.expiresAt <= Date.now()) {
    await clearState();
    return undefined;
  }
  return state;
}
function matches(
  state: ReadyDraftState | undefined,
  message: { snapshotId: string; generationId: string },
): state is ReadyDraftState {
  return (
    state?.draft.snapshotId === message.snapshotId && state.generationId === message.generationId
  );
}
async function captureTab(tabId: number): Promise<ExtensionResponse> {
  await clearState();
  await setState({ status: "capturing" });
  let captured:
    | {
        documentId: string;
        draft: Extract<ContentScriptResponse, { ok: true; draft: unknown }>["draft"];
      }
    | undefined;
  try {
    const frames = await chrome.scripting.executeScript({
      files: ["content-script.js"],
      target: { tabId },
    });
    const documentId = frames.find((frame) => frame.frameId === 0)?.documentId;
    if (!documentId) throw new Error("No document.");
    const response = await sendToEditor({ tabId, documentId }, { type: "CAPTURE_FOCUSED_EDITOR" });
    if (!response.ok || !("draft" in response))
      throw new Error(response.ok ? "No draft returned." : response.message);
    captured = { documentId, draft: response.draft };
    await setState({
      status: "ready",
      draft: response.draft,
      tabId,
      documentId,
      phase: "captured",
    });
    await chrome.alarms.create(EXPIRY_ALARM, { when: response.draft.expiresAt });
    return { ok: true, captured: true };
  } catch {
    if (captured) {
      try {
        await sendToEditor(
          { tabId, documentId: captured.documentId },
          { type: "CLEAR_SNAPSHOT", snapshotId: captured.draft.snapshotId },
        );
      } catch {
        /* The content-script timer remains a bounded fallback if cleanup cannot be delivered. */
      }
      await chrome.storage.session.remove(ACTIVE_DRAFT_STORAGE_KEY);
      await chrome.alarms.clear(EXPIRY_ALARM);
    }
    const message =
      "Could not capture an eligible field. Focus it on a normal website and invoke the extension again.";
    await setState({ status: "error", message });
    return failure("INVALID_REQUEST", message);
  }
}
async function runRewrite(
  message: Extract<ExtensionRequest, { type: "RUN_REWRITE" }>,
): Promise<ExtensionResponse> {
  const prepared = await locked(async () => {
    const state = await readyState();
    if (
      !state ||
      state.draft.snapshotId !== message.snapshotId ||
      state.phase === "applied" ||
      state.phase === "generating"
    ) {
      return failure(
        "CONFLICT",
        "Capture a draft before generating, or cancel the current rewrite.",
      );
    }
    const consent = await chrome.storage.local.get(PRIVACY_CONSENT_KEY);
    if (consent[PRIVACY_CONSENT_KEY] !== consentScope(__SMARTASSISTANCE_API_BASE_URL__)) {
      return failure(
        "AUTHENTICATION_REQUIRED",
        "Read and accept the privacy notice before sending a draft.",
      );
    }
    const controller = new AbortController();
    pending = { controller, generationId: message.generationId, snapshotId: message.snapshotId };
    await setState({ ...state, phase: "generating", generationId: message.generationId });
    return { state, controller };
  });
  if (!("state" in prepared)) return prepared;
  const { state, controller } = prepared;
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    API_TIMEOUT_MS,
  );
  let outcome: ExtensionResponse;
  try {
    const stored = await chrome.storage.session.get(AUTH_TOKEN_STORAGE_KEY);
    controller.signal.throwIfAborted();
    const token = stored[AUTH_TOKEN_STORAGE_KEY];
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const accessToken =
      typeof token === "string" && token ? token : __SMARTASSISTANCE_BETA_API_TOKEN__;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${__SMARTASSISTANCE_API_BASE_URL__}/v1/rewrites`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ ...message.settings, text: state.draft.text }),
    });
    const body: unknown = await response.json();
    controller.signal.throwIfAborted();
    outcome =
      response.ok && isRewriteResponse(body)
        ? {
            ok: true,
            rewrite: body,
            snapshotId: message.snapshotId,
            generationId: message.generationId,
          }
        : isApiErrorResponse(body)
          ? failure(body.error.code, body.error.message)
          : failure("PROVIDER_ERROR", "The rewrite service returned an invalid response.");
  } catch {
    outcome = controller.signal.aborted
      ? failure(
          controller.signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED",
          "The rewrite stopped. Your original is unchanged.",
        )
      : failure("PROVIDER_ERROR", "Could not reach the rewrite service.");
  } finally {
    clearTimeout(timeout);
  }
  return locked(async () => {
    const current = await readyState();
    if (!matches(current, message) || current.phase !== "generating" || controller.signal.aborted) {
      if (matches(current, message) && current.phase === "generating") {
        const { generationId: _generation, ...rest } = current;
        await setState({ ...rest, phase: "captured" });
      }
      if (pending?.controller === controller) pending = undefined;
      return !outcome.ok
        ? outcome
        : failure("CANCELLED", "This rewrite no longer belongs to the active draft.");
    }
    pending = undefined;
    if (outcome.ok) await setState({ ...current, phase: "preview" });
    else {
      const { generationId: _generation, ...rest } = current;
      await setState({ ...rest, phase: "captured" });
    }
    return outcome;
  });
}
async function handleMutation(
  message: Exclude<ExtensionRequest, { type: "RUN_REWRITE" }>,
): Promise<ExtensionResponse> {
  switch (message.type) {
    case "ACCEPT_PRIVACY_NOTICE":
      await chrome.storage.local.set({
        [PRIVACY_CONSENT_KEY]: consentScope(__SMARTASSISTANCE_API_BASE_URL__),
      });
      return { ok: true, consented: true };
    case "CLEAR_PRIVATE_DATA":
      await chrome.storage.local.remove(PRIVACY_CONSENT_KEY);
      await clearState();
      return { ok: true, cleared: true };
    case "CAPTURE_ACTIVE_EDITOR": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id === undefined
        ? failure("INVALID_REQUEST", "No active tab.")
        : captureTab(tab.id);
    }
    case "CANCEL_REWRITE": {
      const state = await readyState();
      if (!matches(state, message) || state.phase !== "generating")
        return failure("CONFLICT", "This rewrite is no longer running.");
      pending?.controller.abort();
      pending = undefined;
      const { generationId: _generation, ...rest } = state;
      await setState({ ...rest, phase: "captured" });
      return { ok: true, cancelled: true };
    }
    case "APPLY_ACTIVE_REWRITE":
    case "UNDO_ACTIVE_REWRITE": {
      const state = await readyState();
      const applying = message.type === "APPLY_ACTIVE_REWRITE";
      if (!matches(state, message) || state.phase !== (applying ? "preview" : "applied")) {
        return failure("CONFLICT", "This preview is no longer available for replacement or undo.");
      }
      try {
        const response = await sendToEditor(
          state,
          message.type === "APPLY_ACTIVE_REWRITE"
            ? { type: "APPLY_REWRITE", snapshotId: message.snapshotId, text: message.text }
            : { type: "UNDO_REWRITE", snapshotId: message.snapshotId },
        );
        if (!response.ok) return response;
        if (applying && "applied" in response) {
          await setState({ ...state, phase: "applied" });
          return { ok: true, applied: true };
        }
        if (!applying && "undone" in response) {
          const { generationId: _generation, ...rest } = state;
          await setState({ ...rest, phase: "captured" });
          return { ok: true, undone: true };
        }
        return failure("CONFLICT", "The editor did not confirm the change.");
      } catch {
        return failure("CONFLICT", "The editor is unavailable. Copy the preview instead.");
      }
    }
  }
}
function openAndCapture(tabId: number): void {
  void chrome.sidePanel.open({ tabId }).catch(() => undefined);
  void locked(() => captureTab(tabId));
}
chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() =>
    chrome.contextMenus.create({
      contexts: ["editable"],
      id: CONTEXT_MENU_ID,
      title: "Rewrite with SmartAssistance",
    }),
  );
});
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) openAndCapture(tab.id);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "rewrite-focused-text" && tab?.id !== undefined) openAndCapture(tab.id);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && tab?.id !== undefined) openAndCapture(tab.id);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === EXPIRY_ALARM)
    void locked(async () => {
      await readyState();
    });
});
async function invalidateTab(tabId: number): Promise<void> {
  const state = await readState();
  if (state?.status === "ready" && state.tabId === tabId) await clearState();
}
chrome.tabs.onRemoved.addListener((tabId) => {
  void locked(() => invalidateTab(tabId));
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" || change.url !== undefined)
    void locked(() => invalidateTab(tabId));
});
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    sendResponse(failure("AUTHENTICATION_REQUIRED", "Untrusted extension message."));
    return false;
  }
  if (!isExtensionRequest(message)) {
    sendResponse(failure("INVALID_REQUEST", "Invalid extension message."));
    return false;
  }
  const response =
    message.type === "RUN_REWRITE" ? runRewrite(message) : locked(() => handleMutation(message));
  void response
    .then(sendResponse)
    .catch(() => sendResponse(failure("PROVIDER_ERROR", "The extension request failed.")));
  return true;
});
// A restarted worker cannot resume a lost request. Keep only an unexpired capture.
void locked(async () => {
  const state = await readyState();
  if (state?.phase === "generating") {
    const { generationId: _generation, ...rest } = state;
    await setState({ ...rest, phase: "captured" });
  }
});
