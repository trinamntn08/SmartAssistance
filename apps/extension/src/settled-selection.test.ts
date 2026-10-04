// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettledSelectionReader, SELECTION_SETTLE_MS } from "./settled-selection.js";
let reader: ReturnType<typeof createSettledSelectionReader>;
function selectPassage(): void {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector("#passage") as Node);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<p id="passage">Synthetic reading passage</p>';
  reader = createSettledSelectionReader();
});
afterEach(() => {
  reader.dispose();
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});
describe("finished reading selections", () => {
  it("keeps a selection identity across polls until the selection changes", () => {
    selectPassage();
    vi.advanceTimersByTime(SELECTION_SETTLE_MS);
    const first = reader.capture();
    expect(reader.capture()).toEqual(first);
    selectPassage();
    vi.advanceTimersByTime(SELECTION_SETTLE_MS);
    const next = reader.capture();
    if (!first.ok || !("draft" in first) || !next.ok || !("draft" in next)) {
      throw new Error("Expected settled selections");
    }
    expect(next.draft.snapshotId).not.toBe(first.draft.snapshotId);
  });
  it("waits for release and a stable selection before capture", () => {
    document.dispatchEvent(new Event("pointerdown"));
    selectPassage();
    vi.advanceTimersByTime(1000);
    expect(reader.capture()).toEqual({ ok: true, empty: true });
    document.dispatchEvent(new Event("pointerup"));
    expect(reader.capture()).toEqual({ ok: true, empty: true });
    vi.advanceTimersByTime(SELECTION_SETTLE_MS);
    expect(reader.capture()).toMatchObject({
      ok: true,
      draft: { text: "Synthetic reading passage" },
    });
  });
  it("debounces keyboard selection changes", () => {
    selectPassage();
    vi.advanceTimersByTime(300);
    document.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(100);
    expect(reader.capture()).toEqual({ ok: true, empty: true });
    vi.advanceTimersByTime(SELECTION_SETTLE_MS);
    expect(reader.capture()).toMatchObject({
      ok: true,
      draft: { text: "Synthetic reading passage" },
    });
  });
  it("never monitors writing-field selections", () => {
    document.body.innerHTML =
      '<div contenteditable="true"><span id="passage">Synthetic draft</span></div>';
    selectPassage();
    vi.advanceTimersByTime(SELECTION_SETTLE_MS);
    expect(reader.capture()).toEqual({ ok: true, empty: true });
  });
  it("rejects selections spanning a writing field", () => {
    document.body.innerHTML =
      '<div id="passage"><p>Before</p><div contenteditable="true">Private synthetic draft</div><p>After</p></div>';
    selectPassage();
    vi.advanceTimersByTime(SELECTION_SETTLE_MS);
    expect(reader.capture()).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
});
