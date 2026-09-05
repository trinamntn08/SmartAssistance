import { applyRewrite, captureFocusedEditor, clearEditorSnapshot, undoRewrite } from "./editor.js";
import { isContentScriptRequest } from "./messages.js";

interface SmartAssistanceWindow extends Window {
  __smartAssistanceContentScriptLoaded?: boolean;
}
const smartWindow = window as SmartAssistanceWindow;
if (!smartWindow.__smartAssistanceContentScriptLoaded) {
  smartWindow.__smartAssistanceContentScriptLoaded = true;
  window.addEventListener("pagehide", () => clearEditorSnapshot());
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL("")) ||
      !isContentScriptRequest(message)
    ) {
      sendResponse({ ok: false, code: "INVALID_REQUEST", message: "Invalid editor request." });
      return;
    }
    switch (message.type) {
      case "CAPTURE_FOCUSED_EDITOR":
        sendResponse(captureFocusedEditor());
        break;
      case "APPLY_REWRITE":
        sendResponse(applyRewrite(message.snapshotId, message.text));
        break;
      case "UNDO_REWRITE":
        sendResponse(undoRewrite(message.snapshotId));
        break;
      case "CLEAR_SNAPSHOT":
        clearEditorSnapshot(message.snapshotId);
        sendResponse({ ok: true, cleared: true });
        break;
    }
  });
}
