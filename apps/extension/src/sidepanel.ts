import { parseRewriteRequest } from "@smartassistance/contracts";
import {
  ACTIVE_DRAFT_STORAGE_KEY,
  PRIVACY_CONSENT_KEY,
  TRANSLATION_LANGUAGE_KEY,
  READING_PORT_NAME,
  READING_READY_MESSAGE,
  consentScope,
  isActiveDraftState,
  isExtensionResponse,
  type ActiveDraftState,
  type ExtensionRequest,
  type ExtensionResponse,
  type ReadyDraftState,
} from "./messages.js";
import "./sidepanel.css";
import { createPronunciation } from "./pronunciation.js";
declare const __SMARTASSISTANCE_API_BASE_URL__: string;

function elementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing side panel element: ${id}`);
  return element as T;
}
const status = elementById<HTMLParagraphElement>("status");
const workspace = elementById<HTMLElement>("workspace");
const original = elementById<HTMLTextAreaElement>("original");
const originalToggle = elementById<HTMLButtonElement>("original-toggle");
let originalExpanded = false;
const warning = elementById<HTMLParagraphElement>("rich-text-warning");
const operation = elementById<HTMLSelectElement>("operation");
const styleOption = elementById<HTMLLabelElement>("style-option");
const tone = elementById<HTMLSelectElement>("tone");
const language = elementById<HTMLSelectElement>("language");
const generate = elementById<HTMLButtonElement>("generate");
const cancel = elementById<HTMLButtonElement>("cancel");
const result = elementById<HTMLElement>("result");
const preview = elementById<HTMLTextAreaElement>("preview");
const replace = elementById<HTMLButtonElement>("replace");
const undo = elementById<HTMLButtonElement>("undo");
const notice = elementById<HTMLElement>("privacy-notice");
const speechStatus = elementById<HTMLElement>("speech-status");
const voiceInstall = elementById<HTMLElement>("voice-install");
const voiceInstructions = elementById<HTMLElement>("voice-install-instructions");
const voiceSettings = elementById<HTMLAnchorElement>("voice-settings");
const voiceHelp = elementById<HTMLAnchorElement>("voice-install-help");
const originalSound = elementById<HTMLButtonElement>("original-sound");
const translationSound = elementById<HTMLButtonElement>("translation-sound");
let activeSound: HTMLButtonElement | undefined;
let speechRevision = 0;
let speaking = false;
let retainedSelection: HTMLTextAreaElement | undefined;
function clearSpeechSelection(): void {
  const field = retainedSelection;
  retainedSelection = undefined;
  if (field) field.setSelectionRange(field.selectionEnd, field.selectionEnd);
}
function retainSpeechSelection(field: HTMLTextAreaElement): void {
  if (field.selectionEnd <= field.selectionStart) return;
  if (retainedSelection && retainedSelection !== field) clearSpeechSelection();
  const { selectionStart, selectionEnd, selectionDirection } = field;
  retainedSelection = field;
  field.focus({ preventScroll: true });
  field.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
}
function clearSelectionElsewhere(event: Event): void {
  const field = retainedSelection;
  const target = event.target;
  if (!field || !(target instanceof Node)) return;
  const sound = field === original ? originalSound : translationSound;
  if (target !== field && !sound.contains(target)) clearSpeechSelection();
}
document.addEventListener("pointerdown", clearSelectionElsewhere);
document.addEventListener("click", clearSelectionElsewhere);
window.addEventListener("blur", clearSpeechSelection);
for (const [button, field] of [
  [originalSound, original],
  [translationSound, preview],
] as const) {
  button.addEventListener("mousedown", (event) => {
    if (
      event.button === 0 &&
      canSpeak() &&
      !field.hidden &&
      field.selectionEnd > field.selectionStart
    )
      event.preventDefault();
  });
}
const playback = createPronunciation(
  typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined"
    ? { synthesis: speechSynthesis, createUtterance: (text) => new SpeechSynthesisUtterance(text) }
    : undefined,
  (state) => {
    speaking = state.speaking;
    speechStatus.textContent = state.message;
    voiceInstall.hidden = !state.missingLanguage;
    if (state.missingLanguage) {
      let name = state.missingLanguage;
      try {
        name = new Intl.DisplayNames(["en"], { type: "language" }).of(name) ?? name;
      } catch {
        // Keep the language tag if Chrome's detector returns an unsupported tag.
      }
      const windows = /Windows/i.test(navigator.userAgent);
      const mac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
      voiceSettings.hidden = !windows;
      voiceHelp.hidden = !windows && !mac && !/CrOS/i.test(navigator.userAgent);
      voiceHelp.href = windows
        ? "https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices"
        : mac
          ? "https://support.apple.com/guide/mac-help/change-the-voice-your-mac-uses-to-speak-text-mchlp2290/mac"
          : "https://support.google.com/accessibility/answer/11221616?hl=en";
      voiceInstructions.textContent = windows
        ? `Install a ${name} voice? Open speech settings, choose Manage voices → Add voices, select ${name}, then Add. Windows asks you to confirm the download. Return here and click the sound icon again; if the voice is still missing, restart Chrome. If the link does not open, go to Settings → Time & language → Speech.`
        : `A ${name} voice is needed. Follow your device's installation guide, then click the sound icon again. You may need to restart Chrome. On Linux, available voices depend on your distribution's speech engine.`;
    }
    if (!speaking) activeSound = undefined;
    updateSoundButtons();
  },
);
function updateSoundButtons(): void {
  for (const [button, name] of [
    [originalSound, "original"],
    [translationSound, "translation"],
  ] as const) {
    const active = button === activeSound;
    button.classList.toggle("playing", active);
    button.setAttribute("aria-label", active ? "Stop playback" : `Listen to ${name}`);
    button.title = active ? "Stop playback" : `Listen to ${name} (selected text or full passage)`;
  }
}
function stopPlayback(): void {
  speechRevision += 1;
  activeSound = undefined;
  playback.stop();
}
function canSpeak(): boolean {
  return (
    consented &&
    translating() &&
    !panelClosed &&
    document.visibilityState !== "hidden" &&
    !!activeState &&
    activeState.draft.expiresAt > Date.now()
  );
}
function selectedOrFull(field: HTMLTextAreaElement): string {
  return field.selectionEnd > field.selectionStart
    ? field.value.slice(field.selectionStart, field.selectionEnd)
    : field.value;
}
async function listen(button: HTMLButtonElement, field: HTMLTextAreaElement): Promise<void> {
  if (canSpeak()) retainSpeechSelection(field);
  if (activeSound === button) {
    stopPlayback();
    return;
  }
  stopPlayback();
  if (!canSpeak() || !activeState) return;
  const text = selectedOrFull(field);
  if (!text.trim()) return;
  const revision = speechRevision;
  const snapshot = activeState.draft.snapshotId;
  activeSound = button;
  updateSoundButtons();
  let speechLanguage = language.value;
  if (field === original) {
    speechStatus.textContent = "Preparing pronunciation...";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const detection = await Promise.race([
        chrome.i18n.detectLanguage(activeState.draft.text),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Language detection timeout")), 2_000);
        }),
      ]);
      const candidate = [...detection.languages]
        .sort((a, b) => b.percentage - a.percentage)
        .find((entry) => entry.language !== "und" && entry.percentage >= 50);
      speechLanguage = candidate?.language ?? "";
    } catch {
      speechLanguage = "";
    } finally {
      clearTimeout(timer);
    }
  }
  if (revision !== speechRevision || activeState?.draft.snapshotId !== snapshot || !canSpeak())
    return;
  if (!speechLanguage) {
    stopPlayback();
    speechStatus.textContent = "Could not identify the language. Try a longer original passage.";
    return;
  }
  playback.speak(text, speechLanguage);
  if (speaking) activeSound = button;
  updateSoundButtons();
}
originalSound.addEventListener("click", () => {
  void listen(originalSound, original);
});
translationSound.addEventListener("click", () => {
  void listen(translationSound, preview);
});
originalToggle.addEventListener("click", () => {
  if (!translating()) return;
  originalExpanded = !originalExpanded;
  if (!originalExpanded) {
    original.setSelectionRange(0, 0);
    if (activeSound === originalSound) stopPlayback();
  }
  updateControls();
});
let activeState: ReadyDraftState | undefined;
let previewIdentity: { snapshotId: string; generationId: string } | undefined;
let pendingGeneration: string | undefined;
let consented = false;
let busy = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let stateRevision = 0;
let consentRevision = 0;
let translationLanguage = "vi";
let initialized = false;
let automaticSnapshot: string | undefined;
let queuedTranslation: { snapshotId: string; targetLanguage: string } | undefined;
let translationLanguageEdited = false;
let writingLanguage = "same";
let readingPort: chrome.runtime.Port | undefined;
let readingReady = false;
let readingTimer: ReturnType<typeof setInterval> | undefined;
let readingPollBusy = false;
let panelClosed = false;
function stopReading(): void {
  stopPlayback();
  clearInterval(readingTimer);
  readingTimer = undefined;
  const port = readingPort;
  readingPort = undefined;
  readingReady = false;
  if (port && translating()) {
    queuedTranslation = undefined;
    pendingGeneration = undefined;
  }
  port?.disconnect();
}
function syncReading(): void {
  if (panelClosed || !initialized || !consented || document.visibilityState === "hidden") {
    stopReading();
    return;
  }
  if (!readingPort) {
    readingPort = chrome.runtime.connect({ name: READING_PORT_NAME });
    const port = readingPort;
    readingReady = false;
    port.onMessage.addListener((message: unknown) => {
      if (readingPort !== port || message !== READING_READY_MESSAGE) return;
      readingReady = true;
      maybeTranslateImmediately();
    });
    port.onDisconnect.addListener(() => {
      if (readingPort === port) {
        readingPort = undefined;
        readingReady = false;
      }
    });
  }
  if (readingTimer) return;
  readingTimer = setInterval(() => {
    if (readingPollBusy || document.visibilityState === "hidden" || !readingPort || !readingReady) {
      syncReading();
      return;
    }
    readingPollBusy = true;
    void sendRequest({ type: "READ_SELECTION" }).finally(() => {
      readingPollBusy = false;
    });
  }, 700);
}
document.addEventListener("visibilitychange", () => {
  syncReading();
  maybeTranslateImmediately();
});
window.addEventListener("pagehide", () => {
  panelClosed = true;
  stopReading();
});
function translating(): boolean {
  return activeState?.source === "selection";
}
function maybeTranslateImmediately(): void {
  if (
    panelClosed ||
    document.visibilityState === "hidden" ||
    !initialized ||
    !consented ||
    !readingReady ||
    busy ||
    !translating() ||
    !activeState ||
    (activeState.phase !== "captured" && activeState.phase !== "preview")
  )
    return;
  const queued = queuedTranslation?.snapshotId === activeState.draft.snapshotId;
  const automatic =
    activeState.autoTranslate &&
    activeState.phase === "captured" &&
    automaticSnapshot !== activeState.draft.snapshotId;
  if (!queued && !automatic) return;
  if (queued && queuedTranslation) language.value = queuedTranslation.targetLanguage;
  queuedTranslation = undefined;
  automaticSnapshot = activeState.draft.snapshotId;
  runGeneration();
}
function showStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}
function updateControls(): void {
  syncReading();
  const translation = translating();
  document.body.classList.toggle("translation-view", translation && consented);
  document.body.classList.toggle(
    "translation-running",
    translation && activeState?.phase === "generating",
  );
  styleOption.hidden = translation || operation.value !== "improve";
  elementById("mode-option").hidden = translation;
  elementById("original-section").hidden = false;
  elementById("original-section").classList.toggle("expanded", translation && originalExpanded);
  original.hidden = translation && !originalExpanded;
  originalToggle.hidden = !translation;
  elementById("original-label").hidden = translation;
  originalToggle.setAttribute("aria-expanded", String(originalExpanded));
  originalToggle.setAttribute(
    "aria-label",
    originalExpanded ? "Hide original text" : "Show original text",
  );
  elementById("copy").hidden = translation;
  replace.hidden = translation;
  preview.readOnly = translation;
  originalSound.hidden = !translation || !consented;
  translationSound.hidden = !translation || !consented;
  speechStatus.hidden = !translation || !consented;
  translationSound.disabled = !preview.value;
  elementById("feature-label").textContent = translation ? "Translation" : "Writing assistant";
  elementById("language-label").textContent = translation ? "Translate to" : "Output language";
  elementById("preview-label").textContent = translation ? "Translation" : "Preview";
  elementById("preview-label").hidden = false;
  generate.textContent = translation ? "Translate" : "Generate preview";
  generate.hidden = translation;
  cancel.textContent = translation ? "Cancel translation" : "Cancel rewrite";
  const sameLanguage = language.querySelector<HTMLOptionElement>('option[value="same"]');
  if (sameLanguage) sameLanguage.hidden = translation;
  notice.hidden = consented;
  generate.disabled =
    !consented ||
    !activeState ||
    busy ||
    activeState.phase === "generating" ||
    activeState.phase === "applied";
  cancel.hidden = activeState?.phase !== "generating";
  replace.disabled =
    translation ||
    busy ||
    activeState?.phase !== "preview" ||
    previewIdentity?.snapshotId !== activeState.draft.snapshotId ||
    previewIdentity?.generationId !== activeState.generationId;
  undo.hidden = translation || activeState?.phase !== "applied";
  undo.disabled = busy || activeState?.phase !== "applied";
}
function renderState(state: ActiveDraftState | undefined): void {
  clearTimeout(expiryTimer);
  if (state?.status !== "ready" || state.draft.expiresAt <= Date.now()) {
    clearSpeechSelection();
    originalExpanded = false;
    stopPlayback();
    activeState = undefined;
    previewIdentity = undefined;
    pendingGeneration = undefined;
    queuedTranslation = undefined;
    original.value = "";
    preview.value = "";
    workspace.hidden = true;
    result.hidden = true;
    showStatus(
      state?.status === "error"
        ? state.message
        : state?.status === "capturing"
          ? "Capturing text..."
          : "Select page text or focus a writing field, then click the extension.",
      state?.status === "error",
    );
    updateControls();
    return;
  }
  const changed = activeState?.draft.snapshotId !== state.draft.snapshotId;
  const wasTranslation = translating();
  activeState = state;
  workspace.hidden = false;
  original.value = state.draft.text;
  warning.hidden = translating() || !state.draft.richText;
  if (changed || wasTranslation !== translating())
    language.value = translating() ? translationLanguage : writingLanguage;
  if (changed) {
    clearSpeechSelection();
    originalExpanded = false;
    stopPlayback();
    queuedTranslation = undefined;
    previewIdentity = undefined;
    pendingGeneration = undefined;
    preview.value = "";
    result.hidden = true;
    showStatus(
      translating()
        ? "Ready to translate."
        : `${state.draft.text.length.toLocaleString()} characters captured. Choose how to rewrite.`,
    );
  }
  expiryTimer = setTimeout(() => {
    renderState(undefined);
    showStatus("The text expired and was cleared. Select text or focus a field again.");
  }, state.draft.expiresAt - Date.now());
  updateControls();
  maybeTranslateImmediately();
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
  updateControls();
});
language.addEventListener("change", () => {
  if (translating()) {
    if (language.value === "same") return;
    translationLanguageEdited = true;
    translationLanguage = language.value;
    queuedTranslation = activeState
      ? { snapshotId: activeState.draft.snapshotId, targetLanguage: language.value }
      : undefined;
    pendingGeneration = undefined;
    previewIdentity = undefined;
    preview.value = "";
    stopPlayback();
    clearSpeechSelection();
    result.hidden = true;
    void chrome.storage.local
      .set({ [TRANSLATION_LANGUAGE_KEY]: translationLanguage })
      .catch(() => showStatus("Could not save the language preference.", true));
    maybeTranslateImmediately();
  } else writingLanguage = language.value;
});
function runGeneration(): void {
  if (
    translating() &&
    (panelClosed || document.visibilityState === "hidden" || !readingPort || !readingReady)
  )
    return;
  if (
    !activeState ||
    !consented ||
    busy ||
    activeState.phase === "generating" ||
    activeState.phase === "applied"
  )
    return;
  const state = activeState;
  const parsed = parseRewriteRequest({
    text: state.draft.text,
    operation: translating() ? "translate" : operation.value,
    ...(!translating() && operation.value === "improve" ? { tone: tone.value } : {}),
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
  showStatus(translating() ? "Translating..." : "Generating a preview...");
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
      if (retainedSelection === preview) clearSpeechSelection();
      preview.value = response.rewrite.rewrittenText;
      stopPlayback();
      result.hidden = false;
      showStatus(
        translating()
          ? "Translation ready."
          : "Preview ready. Review it before replacing the field.",
      );
    })
    .finally(() => {
      if (pendingGeneration === identity.generationId) pendingGeneration = undefined;
      busy = false;
      updateControls();
      maybeTranslateImmediately();
    });
}
generate.addEventListener("click", () => {
  if (!translating()) runGeneration();
});
cancel.addEventListener("click", () => {
  if (!activeState?.generationId) return;
  pendingGeneration = undefined;
  queuedTranslation = undefined;
  const snapshotId = activeState.draft.snapshotId;
  void sendRequest({
    type: "CANCEL_REWRITE",
    snapshotId,
    generationId: activeState.generationId,
  }).then((response) => {
    if (activeState?.draft.snapshotId === snapshotId && !showFailure(response))
      showStatus(
        translating() ? "Translation cancelled." : "Rewrite cancelled. Your original is unchanged.",
      );
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
  if (translating()) return;
  void navigator.clipboard
    .writeText(preview.value)
    .then(() => showStatus("Preview copied."))
    .catch(() => showStatus("Clipboard access was denied.", true));
});
elementById("recapture").addEventListener("click", () => {
  stopPlayback();
  void sendRequest({ type: "CAPTURE_ACTIVE_TEXT" }).then(showFailure);
});
elementById("accept-privacy").addEventListener("click", () => {
  void sendRequest({ type: "ACCEPT_PRIVACY_NOTICE" }).then((response) => {
    if (!showFailure(response)) {
      consentRevision += 1;
      consented = true;
      updateControls();
      maybeTranslateImmediately();
    }
  });
});
elementById("clear-private-data").addEventListener("click", () => {
  consentRevision += 1;
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
    consentRevision += 1;
    consented =
      changes[PRIVACY_CONSENT_KEY]?.newValue === consentScope(__SMARTASSISTANCE_API_BASE_URL__);
    stopPlayback();
    updateControls();
    maybeTranslateImmediately();
  }
});
const revision = stateRevision;
const initialConsentRevision = consentRevision;
void Promise.all([
  chrome.storage.session.get(ACTIVE_DRAFT_STORAGE_KEY),
  chrome.storage.local.get([PRIVACY_CONSENT_KEY, TRANSLATION_LANGUAGE_KEY]),
])
  .then(([stored, local]) => {
    if (consentRevision === initialConsentRevision)
      consented = local[PRIVACY_CONSENT_KEY] === consentScope(__SMARTASSISTANCE_API_BASE_URL__);
    const savedLanguage: unknown = local[TRANSLATION_LANGUAGE_KEY];
    if (
      typeof savedLanguage === "string" &&
      !translationLanguageEdited &&
      savedLanguage !== "same" &&
      [...language.options].some((option) => option.value === savedLanguage)
    ) {
      translationLanguage = savedLanguage;
      if (translating()) language.value = translationLanguage;
    }
    const value: unknown = stored[ACTIVE_DRAFT_STORAGE_KEY];
    initialized = true;
    if (stateRevision === revision) renderState(isActiveDraftState(value) ? value : undefined);
    updateControls();
    maybeTranslateImmediately();
  })
  .catch(() => showStatus("Could not load extension state.", true));
