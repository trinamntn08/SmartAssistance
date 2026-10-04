import { MAX_REWRITE_CHARACTERS } from "@smartassistance/contracts";
import { type ContentScriptResponse, SNAPSHOT_TTL_MS } from "./messages.js";

function excluded(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (
      current.matches(
        "input, textarea, select, [hidden], [inert], :disabled, [aria-hidden='true'], [aria-disabled='true'], [aria-readonly='true']",
      ) ||
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

// Read only the explicit DOM selection; never read surrounding page text.
export function captureSelection(
  documentValue: Document = document,
  excludeWriting = false,
): ContentScriptResponse {
  const selection = documentValue.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return { ok: true, empty: true };
  const text = selection.toString();
  if (!text.trim()) return { ok: true, empty: true };
  if (text.length > MAX_REWRITE_CHARACTERS)
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "Select a shorter passage (up to 10,000 characters).",
    };
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const root = range.commonAncestorContainer;
    const parent = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : root.parentElement;
    if (!parent || excluded(parent) || (excludeWriting && parent.closest("[contenteditable]")))
      return unavailable();
    const walker = documentValue.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    while (node) {
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (
        range.intersectsNode(node) &&
        element &&
        (excluded(element) || (excludeWriting && element.closest("[contenteditable]")))
      )
        return unavailable();
      node = walker.nextNode();
    }
  }
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
