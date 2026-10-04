import { MAX_REWRITE_CHARACTERS } from "@smartassistance/contracts";
import { type ContentScriptResponse, SNAPSHOT_TTL_MS } from "./messages.js";

function parentAcrossShadowRoot(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

function excluded(element: Element): boolean {
  for (let current: Element | null = element; current; current = parentAcrossShadowRoot(current)) {
    if (
      current.matches("[hidden], [inert], :disabled") ||
      current
        .getAttribute("autocomplete")
        ?.toLowerCase()
        .split(/\s+/)
        .some(
          (token) =>
            token.startsWith("cc-") || token === "one-time-code" || token.endsWith("password"),
        )
    )
      return true;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    )
      return true;
  }
  return false;
}

function visuallyHidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = parentAcrossShadowRoot(current)) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      current.hasAttribute("hidden") ||
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    )
      return true;
  }
  return false;
}

function selectedField(
  documentValue: Document,
): HTMLInputElement | HTMLTextAreaElement | undefined {
  let focused = documentValue.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
    ? focused
    : undefined;
}

// Read only the explicit DOM selection; never read surrounding page text.
export function captureSelection(
  documentValue: Document = document,
  excludeWriting = false,
): ContentScriptResponse {
  const field = selectedField(documentValue);
  if (field && !excludeWriting) {
    if (
      excluded(field) ||
      (field instanceof HTMLInputElement &&
        !["email", "search", "tel", "text", "url"].includes(field.type))
    )
      return unavailable();
    const start = field.selectionStart;
    const end = field.selectionEnd;
    if (start !== null && end !== null && end > start)
      return captured(field.value.slice(start, end));
  }
  const selection = documentValue.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return { ok: true, empty: true };
  const text = selection.toString();
  // Chromium returns rendered text here; Range.toString()/textContent would
  // include hidden descendants and must not be used as a capture fallback.
  if (!text.trim()) return { ok: true, empty: true };
  if (text.length > MAX_REWRITE_CHARACTERS) return captured(text);
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const root = range.commonAncestorContainer;
    const parent = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : root.parentElement;
    if (
      !parent ||
      excluded(parent) ||
      parent.closest("input, textarea, select") ||
      (excludeWriting && parent.closest("[contenteditable]"))
    )
      return unavailable();
    const walker = documentValue.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const element = node.parentElement;
      if (
        range.intersectsNode(node) &&
        node.textContent &&
        element &&
        !element.closest("input, textarea, select") &&
        !visuallyHidden(element) &&
        (excluded(element) || (excludeWriting && element.closest("[contenteditable]")))
      )
        return unavailable();
      node = walker.nextNode();
    }
  }
  return captured(text);
}

function captured(text: string): ContentScriptResponse {
  if (!text.trim()) return { ok: true, empty: true };
  if (text.length > MAX_REWRITE_CHARACTERS)
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "Select a shorter passage (up to 10,000 characters).",
    };
  return {
    ok: true,
    draft: {
      richText: false,
      snapshotId: crypto.randomUUID(),
      text,
      expiresAt: Date.now() + SNAPSHOT_TTL_MS,
    },
  };
}

function unavailable(): ContentScriptResponse {
  return {
    ok: false,
    code: "INVALID_REQUEST",
    message: "Select visible page text outside sensitive or unavailable fields.",
  };
}
