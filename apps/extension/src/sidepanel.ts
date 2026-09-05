import { parseRewriteRequest } from "@smartassistance/contracts";
import {
  ACTIVE_DRAFT_STORAGE_KEY,
  PRIVACY_CONSENT_KEY,
  consentScope,
  isActiveDraftState,
  isExtensionResponse,
  type ActiveDraftState,
  type ExtensionRequest,
  type ExtensionResponse,
  type ReadyDraftState,
} from "./messages.js";
import "./sidepanel.css";
declare const __SMARTASSISTANCE_API_BASE_URL__: string;

function elementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing side panel element: ${id}`);
  return element as T;
}
const status = elementById<HTMLParagraphElement>("status");
const workspace = elementById<HTMLElement>("workspace");
const original = elementById<HTMLTextAreaElement>("original");
const warning = elementById<HTMLParagraphElement>("rich-text-warning");
const operation = elementById<HTMLSelectElement>("operation");
const tone = elementById<HTMLSelectElement>("tone");
const language = elementById<HTMLSelectElement>("language");
const generate = elementById<HTMLButtonElement>("generate");
const cancel = elementById<HTMLButtonElement>("cancel");
const result = elementById<HTMLElement>("result");
const preview = elementById<HTMLTextAreaElement>("preview");
const replace = elementById<HTMLButtonElement>("replace");
const undo = elementById<HTMLButtonElement>("undo");
const notice = elementById<HTMLElement>("privacy-notice");
let activeState: ReadyDraftState | undefined;
let previewIdentity: { snapshotId: string; generationId: string } | undefined;
let pendingGeneration: string | undefined;
let consented = false;
let busy = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let stateRevision = 0;
function showStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}
function updateControls(): void {
  notice.hidden = consented;
  generate.disabled =
    !consented ||
    !activeState ||
    busy ||
    activeState.phase === "generating" ||
    activeState.phase === "applied";
  cancel.hidden = activeState?.phase !== "generating";
  replace.disabled =
    busy ||
    activeState?.phase !== "preview" ||
    previewIdentity?.snapshotId !== activeState.draft.snapshotId ||
    previewIdentity?.generationId !== activeState.generationId;
  undo.hidden = activeState?.phase !== "applied";
  undo.disabled = busy || activeState?.phase !== "applied";
}
function renderState(state: ActiveDraftState | undefined): void {
  clearTimeout(expiryTimer);
  if (state?.status !== "ready" || state.draft.expiresAt <= Date.now()) {
    activeState = undefined;
    previewIdentity = undefined;
    pendingGeneration = undefined;
    original.value = "";
    preview.value = "";
    workspace.hidden = true;
    result.hidden = true;
    showStatus(
      state?.status === "error"
        ? state.message
        : state?.status === "capturing"
          ? "Reading the focused editor..."
          : "Focus an editor, then use the extension action.",
      state?.status === "error",
    );
    updateControls();
    return;
  }
  const changed = activeState?.draft.snapshotId !== state.draft.snapshotId;
  activeState = state;
  workspace.hidden = false;
  original.value = state.draft.text;
  warning.hidden = !state.draft.richText;
  if (changed) {
    previewIdentity = undefined;
    pendingGeneration = undefined;
    preview.value = "";
    result.hidden = true;
    showStatus(
      `${state.draft.text.length.toLocaleString()} characters captured. Choose how to rewrite.`,
    );
  }
  expiryTimer = setTimeout(() => {
    renderState(undefined);
    showStatus("The draft expired and was cleared. Capture the field again.");
  }, state.draft.expiresAt - Date.now());
  updateControls();
}
async function sendRequest(request: ExtensionRequest): Promise<ExtensionResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return isExtensionResponse(response)
      ? response
      : {
          ok: false,
          code: "PROVIDER_ERROR",
          message: "The extension returned an invalid response.",
        };
  } catch {
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: "The extension request failed. Please try again.",
    };
  }
}
function showFailure(response: ExtensionResponse): boolean {
  if (!response.ok) {
    showStatus(response.message, true);
    return true;
  }
  return false;
}
operation.addEventListener("change", () => {
  if (operation.value === "translate" && language.value === "same") language.value = "en";
});
generate.addEventListener("click", () => {
  if (!activeState || !consented || generate.disabled) return;
  const state = activeState;
  const parsed = parseRewriteRequest({
    text: state.draft.text,
    operation: operation.value,
    tone: tone.value,
    targetLanguage: language.value,
  });
  if (!parsed.success) {
    showStatus(parsed.message, true);
    return;
  }
  const identity = { snapshotId: state.draft.snapshotId, generationId: crypto.randomUUID() };
  pendingGeneration = identity.generationId;
  const { text: _text, ...settings } = parsed.value;
  busy = true;
  updateControls();
  showStatus("Generating a preview...");
  void sendRequest({ type: "RUN_REWRITE", ...identity, settings })
    .then((response) => {
      if (
        activeState?.draft.snapshotId !== identity.snapshotId ||
        pendingGeneration !== identity.generationId
      )
        return;
      // Cancelled or superseded attempts can never restore an earlier preview.
      if (showFailure(response) || !response.ok || !("rewrite" in response)) return;
      if (
        response.snapshotId !== identity.snapshotId ||
        response.generationId !== identity.generationId
      )
        return;
      previewIdentity = identity;
      preview.value = response.rewrite.rewrittenText;
      result.hidden = false;
      showStatus("Preview ready. Review it before replacing the field.");
    })
    .finally(() => {
      if (pendingGeneration === identity.generationId) pendingGeneration = undefined;
      busy = false;
      updateControls();
    });
});
cancel.addEventListener("click", () => {
  if (!activeState?.generationId) return;
  pendingGeneration = undefined;
  const snapshotId = activeState.draft.snapshotId;
  void sendRequest({
    type: "CANCEL_REWRITE",
    snapshotId,
    generationId: activeState.generationId,
  }).then((response) => {
    if (activeState?.draft.snapshotId === snapshotId && !showFailure(response))
      showStatus("Rewrite cancelled. Your original is unchanged.");
  });
});
replace.addEventListener("click", () => {
  if (replace.disabled || !previewIdentity || !preview.value.trim()) return;
  const identity = previewIdentity;
  busy = true;
  updateControls();
  void sendRequest({ type: "APPLY_ACTIVE_REWRITE", ...identity, text: preview.value })
    .then((response) => {
      if (activeState?.draft.snapshotId === identity.snapshotId && !showFailure(response))
        showStatus(
          "Field replaced. Undo is available until the field changes or the draft expires.",
        );
    })
    .finally(() => {
      busy = false;
      updateControls();
    });
});
undo.addEventListener("click", () => {
  if (undo.disabled || !activeState?.generationId) return;
  const snapshotId = activeState.draft.snapshotId;
  busy = true;
  updateControls();
  void sendRequest({
    type: "UNDO_ACTIVE_REWRITE",
    snapshotId,
    generationId: activeState.generationId,
  })
    .then((response) => {
      if (activeState?.draft.snapshotId === snapshotId && !showFailure(response))
        showStatus("Original text restored.");
    })
    .finally(() => {
      busy = false;
      updateControls();
    });
});
elementById("copy").addEventListener("click", () => {
  void navigator.clipboard
    .writeText(preview.value)
    .then(() => showStatus("Preview copied."))
    .catch(() => showStatus("Clipboard access was denied.", true));
});
elementById("recapture").addEventListener("click", () => {
  void sendRequest({ type: "CAPTURE_ACTIVE_EDITOR" }).then(showFailure);
});
elementById("accept-privacy").addEventListener("click", () => {
  void sendRequest({ type: "ACCEPT_PRIVACY_NOTICE" }).then((response) => {
    if (!showFailure(response)) {
      consented = true;
      updateControls();
    }
  });
});
elementById("clear-private-data").addEventListener("click", () => {
  consented = false;
  renderState(undefined);
  void sendRequest({ type: "CLEAR_PRIVATE_DATA" }).then((response) => {
    if (!showFailure(response)) showStatus("Captured text cleared and consent withdrawn.");
  });
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && ACTIVE_DRAFT_STORAGE_KEY in changes) {
    stateRevision += 1;
    const value: unknown = changes[ACTIVE_DRAFT_STORAGE_KEY]?.newValue;
    renderState(isActiveDraftState(value) ? value : undefined);
  }
  if (areaName === "local" && PRIVACY_CONSENT_KEY in changes) {
    consented =
      changes[PRIVACY_CONSENT_KEY]?.newValue === consentScope(__SMARTASSISTANCE_API_BASE_URL__);
    updateControls();
  }
});
const revision = stateRevision;
void Promise.all([
  chrome.storage.session.get(ACTIVE_DRAFT_STORAGE_KEY),
  chrome.storage.local.get(PRIVACY_CONSENT_KEY),
])
  .then(([stored, local]) => {
    consented = local[PRIVACY_CONSENT_KEY] === consentScope(__SMARTASSISTANCE_API_BASE_URL__);
    const value: unknown = stored[ACTIVE_DRAFT_STORAGE_KEY];
    if (stateRevision === revision) renderState(isActiveDraftState(value) ? value : undefined);
    updateControls();
  })
  .catch(() => showStatus("Could not load extension state.", true));
