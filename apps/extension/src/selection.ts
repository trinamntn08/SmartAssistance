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

function insideField(element: Element, excludeWriting: boolean): boolean {
  for (let current: Element | null = element; current; current = parentAcrossShadowRoot(current)) {
    if (
      current.matches("input, textarea, select") ||
      (excludeWriting && current.hasAttribute("contenteditable"))
    )
      return true;
  }
  return false;
}

function selectionRanges(documentValue: Document, selection: Selection): Range[] | undefined {
  // Mouse selections inside shadow DOM can have rendered text while the document
  // selection reports a collapsed, retargeted range. Inspect open roots only;
  // never substitute a host's textContent for the selected payload.
  const roots: ShadowRoot[] = [];
  const pending: ParentNode[] = [documentValue];
  while (pending.length) {
    const scope = pending.pop();
    if (!scope) break;
    for (const element of scope.querySelectorAll("*")) {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
        pending.push(element.shadowRoot);
      }
    }
  }
  const composed = selection as Selection & {
    getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[];
  };
  if (typeof composed.getComposedRanges === "function") {
    const ranges: Range[] = [];
    for (const value of composed.getComposedRanges({ shadowRoots: roots })) {
      const scope = value.startContainer.getRootNode();
      // A Range cannot safely validate endpoints in different trees, or a
      // closed-root selection that has been expanded to its surrounding host.
      if (
        scope !== value.endContainer.getRootNode() ||
        (selection.isCollapsed && scope === documentValue)
      )
        return undefined;
      const range = documentValue.createRange();
      range.setStart(value.startContainer, value.startOffset);
      range.setEnd(value.endContainer, value.endOffset);
      if (!range.collapsed) ranges.push(range);
    }
    return ranges;
  }
  // Older Chromium versions expose a root-scoped selection instead.
  for (const root of roots.reverse()) {
    const scoped = (
      root as ShadowRoot & { getSelection?: () => Selection | null }
    ).getSelection?.();
    if (scoped && !scoped.isCollapsed && scoped.rangeCount)
      return Array.from({ length: scoped.rangeCount }, (_, index) => scoped.getRangeAt(index));
  }
  return selection.isCollapsed
    ? []
    : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
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
  if (!selection || selection.rangeCount === 0) return { ok: true, empty: true };
  const text = selection.toString();
  // Chromium returns rendered text here; Range.toString()/textContent would
  // include hidden descendants and must not be used as a capture fallback.
  if (!text.trim()) return { ok: true, empty: true };
  if (text.length > MAX_REWRITE_CHARACTERS) return captured(text);
  const ranges = selectionRanges(documentValue, selection);
  if (!ranges) return unavailable();
  if (!ranges.length) return { ok: true, empty: true };
  let validatedText = "";
  for (const range of ranges) {
    const root = range.commonAncestorContainer;
    const parent =
      root instanceof ShadowRoot
        ? root.host
        : root.nodeType === Node.ELEMENT_NODE
          ? (root as Element)
          : root.parentElement;
    if (!parent || excluded(parent) || insideField(parent, excludeWriting)) return unavailable();
    const walker = documentValue.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();
    while (node) {
      const element = node.parentElement;
      if (
        range.intersectsNode(node) &&
        node.textContent &&
        element &&
        !insideField(element, false) &&
        !visuallyHidden(element) &&
        (excluded(element) || (excludeWriting && insideField(element, true)))
      )
        return unavailable();
      if (
        element &&
        range.intersectsNode(node) &&
        !insideField(element, false) &&
        !visuallyHidden(element)
      ) {
        const start = range.startContainer === node ? range.startOffset : 0;
        const end = range.endContainer === node ? range.endOffset : (node.textContent?.length ?? 0);
        validatedText += node.textContent?.slice(start, end) ?? "";
      }
      node = walker.nextNode();
    }
  }
  // Rendered separators can differ from DOM whitespace. All other payload
  // characters must come from inspected text rather than an opaque shadow host.
  if (validatedText.replace(/\s/g, "") !== text.replace(/\s/g, "")) return unavailable();
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
