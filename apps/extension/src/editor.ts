import { MAX_REWRITE_CHARACTERS, MAX_REWRITTEN_CHARACTERS } from "@smartassistance/contracts";
import { type ContentScriptResponse, type EditorDraft, SNAPSHOT_TTL_MS } from "./messages.js";

type SupportedEditor = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
interface EditorSnapshot {
  element: SupportedEditor;
  document: Document;
  originalText: string;
  originalMarkup?: string;
  originalNodes?: { node: ChildNode; signature: string }[];
  appliedText?: string;
  appliedMarkup?: string;
  snapshotId: string;
  expiresAt: number;
  nativeEditing: boolean;
}
const SUPPORTED_INPUT_TYPES = new Set(["email", "search", "tel", "text", "url"]);
let activeSnapshot: EditorSnapshot | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

export function clearEditorSnapshot(snapshotId?: string): void {
  if (snapshotId && activeSnapshot?.snapshotId !== snapshotId) return;
  clearTimeout(expiryTimer);
  activeSnapshot = undefined;
}
function isInput(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}
function isUnavailable(element: HTMLElement): boolean {
  if (
    !element.isConnected ||
    element.matches(":disabled") ||
    (isInput(element) && element.readOnly)
  )
    return true;
  if (element instanceof HTMLInputElement && !SUPPORTED_INPUT_TYPES.has(element.type)) return true;
  if (
    element
      .getAttribute("autocomplete")
      ?.toLowerCase()
      .split(/\s+/)
      .some(
        (token) =>
          token.startsWith("cc-") || token === "one-time-code" || token.endsWith("password"),
      )
  )
    return true;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (
      ancestor.hidden ||
      ancestor.hasAttribute("inert") ||
      ancestor.getAttribute("aria-hidden") === "true" ||
      ancestor.getAttribute("aria-disabled") === "true" ||
      ancestor.getAttribute("aria-readonly") === "true"
    )
      return true;
    const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    )
      return true;
  }
  if (!isInput(element)) {
    const editable = element.closest("[contenteditable]");
    return (
      editable?.getAttribute("contenteditable") === "false" ||
      !(
        element.isContentEditable ||
        ["true", "", "plaintext-only"].includes(
          element.getAttribute("contenteditable") ?? "missing",
        )
      )
    );
  }
  return false;
}
function findSupportedEditor(documentValue: Document): SupportedEditor | undefined {
  const element = documentValue.activeElement;
  if (!(element instanceof HTMLElement)) return undefined;
  const editor = isInput(element) ? element : element.closest<HTMLElement>("[contenteditable]");
  return editor && !isUnavailable(element) && !isUnavailable(editor) ? editor : undefined;
}
function readEditorText(element: SupportedEditor): string {
  return isInput(element) ? element.value : (element.innerText ?? element.textContent ?? "");
}
function markup(element: SupportedEditor): string | undefined {
  return isInput(element) ? undefined : element.innerHTML;
}
function usesManagedEditor(element: SupportedEditor): boolean {
  return (
    !isInput(element) &&
    (element.hasAttribute("data-lexical-editor") ||
      element.querySelector('[data-contents="true"]') !== null)
  );
}
async function insertNativeText(snapshot: EditorSnapshot, text: string): Promise<boolean> {
  const { element, document: documentValue } = snapshot;
  const expectedText = readEditorText(element);
  const expectedMarkup = markup(element);
  if (typeof documentValue.execCommand !== "function") return false;
  element.focus();
  // Focus handlers can change or replace the captured editor.
  if (
    isUnavailable(element) ||
    documentValue.activeElement !== element ||
    readEditorText(element) !== expectedText ||
    markup(element) !== expectedMarkup
  )
    return false;
  const selection = documentValue.getSelection();
  if (!selection) return false;
  const range = documentValue.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  // Plain text only. Let the browser emit editing events for the page's state model.
  try {
    documentValue.execCommand("insertText", false, text);
  } catch {
    return false;
  }
  // Allow synchronous listeners and queued reconciliation to finish before checking.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return (
    activeSnapshot === snapshot &&
    !isUnavailable(element) &&
    snapshot.expiresAt > Date.now() &&
    readEditorText(element) === text
  );
}
function dispatchEditorEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
function writeEditorText(element: SupportedEditor, text: string): void {
  if (isInput(element)) {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Editor value setter is unavailable.");
    setter.call(element, text);
    element.focus();
    if (!(element instanceof HTMLInputElement) || element.type !== "email") {
      element.setSelectionRange(element.value.length, element.value.length);
    }
    return;
  }
  const span = element.ownerDocument.createElement("span");
  span.style.whiteSpace = "pre-wrap";
  span.textContent = text;
  element.replaceChildren(span);
  element.focus();
}
function currentSnapshot(snapshotId: string): EditorSnapshot | undefined {
  if (activeSnapshot && activeSnapshot.expiresAt <= Date.now()) clearEditorSnapshot();
  const snapshot = activeSnapshot;
  return snapshot?.snapshotId === snapshotId &&
    snapshot.element.ownerDocument === snapshot.document &&
    !isUnavailable(snapshot.element)
    ? snapshot
    : undefined;
}
function conflict(message: string): ContentScriptResponse {
  return { ok: false, code: "CONFLICT", message };
}
export function captureFocusedEditor(documentValue: Document = document): ContentScriptResponse {
  clearEditorSnapshot();
  const element = findSupportedEditor(documentValue);
  if (!element)
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message:
        "Focus an eligible writing field and try again. Sensitive or unavailable fields cannot be captured.",
    };
  const text = readEditorText(element);
  if (!text.trim() || text.length > MAX_REWRITE_CHARACTERS) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "The field must contain between 1 and 10,000 characters.",
    };
  }
  const draft: EditorDraft = {
    richText: !isInput(element) && element.childElementCount > 0,
    snapshotId: crypto.randomUUID(),
    text,
    expiresAt: Date.now() + SNAPSHOT_TTL_MS,
  };
  const originalMarkup = markup(element);
  activeSnapshot = {
    element,
    document: element.ownerDocument,
    originalText: text,
    snapshotId: draft.snapshotId,
    expiresAt: draft.expiresAt,
    nativeEditing: usesManagedEditor(element),
    ...(originalMarkup === undefined ? {} : { originalMarkup }),
  };
  expiryTimer = setTimeout(clearEditorSnapshot, SNAPSHOT_TTL_MS);
  return { ok: true, draft };
}
export async function applyRewrite(
  snapshotId: string,
  text: string,
): Promise<ContentScriptResponse> {
  const snapshot = currentSnapshot(snapshotId);
  if (!snapshot)
    return conflict("The captured editor expired or is unavailable. Copy the preview instead.");
  if (!text.trim() || text.length > MAX_REWRITTEN_CHARACTERS)
    return { ok: false, code: "INVALID_REQUEST", message: "The rewritten text is invalid." };
  if (
    snapshot.appliedText !== undefined ||
    readEditorText(snapshot.element) !== snapshot.originalText ||
    markup(snapshot.element) !== snapshot.originalMarkup
  ) {
    return conflict(
      "The editor changed after capture. It was not overwritten. Copy the preview instead.",
    );
  }
  if (snapshot.nativeEditing) {
    if (!(await insertNativeText(snapshot, text))) {
      clearEditorSnapshot(snapshotId);
      return conflict(
        "This editor did not accept the replacement. Check the field and copy the preview instead.",
      );
    }
  } else {
    if (!isInput(snapshot.element)) {
      const serializer = new XMLSerializer();
      snapshot.originalNodes = [...snapshot.element.childNodes].map((node) => ({
        node,
        signature: serializer.serializeToString(node),
      }));
    }
    writeEditorText(snapshot.element, text);
  }
  snapshot.appliedText = readEditorText(snapshot.element);
  const appliedMarkup = markup(snapshot.element);
  if (appliedMarkup !== undefined) snapshot.appliedMarkup = appliedMarkup;
  if (!snapshot.nativeEditing) dispatchEditorEvents(snapshot.element);
  return { ok: true, applied: true };
}
export async function undoRewrite(snapshotId: string): Promise<ContentScriptResponse> {
  const snapshot = currentSnapshot(snapshotId);
  if (
    !snapshot ||
    snapshot.appliedText === undefined ||
    readEditorText(snapshot.element) !== snapshot.appliedText ||
    markup(snapshot.element) !== snapshot.appliedMarkup
  ) {
    return conflict("Undo is unavailable because the editor changed or the snapshot expired.");
  }
  if (snapshot.nativeEditing) {
    if (!(await insertNativeText(snapshot, snapshot.originalText))) {
      clearEditorSnapshot(snapshotId);
      return conflict("This editor did not accept undo. Check the field before continuing.");
    }
    snapshot.originalMarkup = snapshot.element.innerHTML;
  } else if (snapshot.originalNodes) {
    const serializer = new XMLSerializer();
    if (
      snapshot.originalNodes.some(
        ({ node, signature }) =>
          node.parentNode !== null ||
          node.ownerDocument !== snapshot.document ||
          serializer.serializeToString(node) !== signature,
      )
    ) {
      return conflict("Undo is unavailable because the original content changed or moved.");
    }
    snapshot.element.replaceChildren(...snapshot.originalNodes.map(({ node }) => node));
    snapshot.element.focus();
  } else writeEditorText(snapshot.element, snapshot.originalText);
  delete snapshot.appliedText;
  delete snapshot.appliedMarkup;
  delete snapshot.originalNodes;
  if (!snapshot.nativeEditing) dispatchEditorEvents(snapshot.element);
  return { ok: true, undone: true };
}
