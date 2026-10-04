import type { ContentScriptResponse } from "./messages.js";
import { captureSelection } from "./selection.js";

export const SELECTION_SETTLE_MS = 350;

// These events track gesture timing only. Text is read solely on a panel poll.
export function createSettledSelectionReader(documentValue: Document = document) {
  let pointerDown = false;
  let changedAt = Number.NEGATIVE_INFINITY;
  let selectionId = crypto.randomUUID();
  const changed = () => {
    changedAt = Date.now();
    selectionId = crypto.randomUUID();
  };
  const down = () => {
    pointerDown = true;
  };
  const up = () => {
    pointerDown = false;
    changed();
  };
  documentValue.addEventListener("selectionchange", changed);
  documentValue.addEventListener("pointerdown", down);
  documentValue.addEventListener("pointerup", up);
  documentValue.addEventListener("pointercancel", up);
  return {
    capture(): ContentScriptResponse {
      if (documentValue.designMode?.toLowerCase() === "on") return { ok: true, empty: true };
      const focused = documentValue.activeElement;
      if (focused?.matches("input, textarea, select") || focused?.closest("[contenteditable]"))
        return { ok: true, empty: true };
      if (pointerDown || Date.now() - changedAt < SELECTION_SETTLE_MS)
        return { ok: true, empty: true };
      const selection = documentValue.getSelection();
      const anchor = selection?.anchorNode?.parentElement;
      const focus = selection?.focusNode?.parentElement;
      if (anchor?.closest("[contenteditable]") || focus?.closest("[contenteditable]"))
        return { ok: true, empty: true };
      const response = captureSelection(documentValue, true);
      if (response.ok && "draft" in response) response.draft.snapshotId = selectionId;
      return response;
    },
    dispose(): void {
      documentValue.removeEventListener("selectionchange", changed);
      documentValue.removeEventListener("pointerdown", down);
      documentValue.removeEventListener("pointerup", up);
      documentValue.removeEventListener("pointercancel", up);
    },
  };
}
