// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { captureSelection } from "./selection.js";
import { applyRewrite } from "./editor.js";

function selectContents(selector: string): void {
  const element = document.querySelector(selector);
  if (!element) throw new Error("Missing synthetic element");
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});
describe("selected page text", () => {
  it("reads only selected text, without creating a replaceable editor snapshot", async () => {
    document.body.innerHTML =
      '<p>Surrounding synthetic text</p><p id="chosen">Bonjour <b>Marie</b>, 42!</p>';
    selectContents("#chosen");
    const response = captureSelection();
    expect(response).toMatchObject({
      ok: true,
      draft: { text: "Bonjour Marie, 42!", richText: false },
    });
    if (!response.ok || !("draft" in response)) throw new Error("Missing selection");
    expect(await applyRewrite(response.draft.snapshotId, "Hello Marie, 42!")).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
  });
  it("does not fall back to reading the page without a selection", () => {
    document.body.innerHTML = "Synthetic article";
    expect(captureSelection()).toEqual({ ok: true, empty: true });
  });
  it("captures a partial passage", () => {
    document.body.textContent = "Outside Bonjour Outside";
    const node = document.body.firstChild;
    if (!node) throw new Error("Missing synthetic text node");
    const range = document.createRange();
    range.setStart(node, 8);
    range.setEnd(node, 15);
    document.getSelection()?.addRange(range);
    expect(captureSelection()).toMatchObject({ ok: true, draft: { text: "Bonjour" } });
  });
  it.each([
    '<p id="chosen" hidden>private</p>',
    '<div inert><p id="chosen">private</p></div>',
    '<p id="chosen" style="display:none">private</p>',
    '<div aria-readonly="true"><p id="chosen">private</p></div>',
    '<div autocomplete="cc-number"><p id="chosen">synthetic</p></div>',
    '<textarea id="chosen" readonly>private</textarea>',
    '<div id="chosen">Public <span hidden>private</span></div>',
  ])("excludes sensitive and unavailable selection %s", (html) => {
    document.body.innerHTML = html;
    selectContents("#chosen");
    expect(captureSelection()).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
  it("rejects oversized text without truncating", () => {
    document.body.innerHTML = `<p id="chosen">${"a".repeat(10_001)}</p>`;
    selectContents("#chosen");
    expect(captureSelection()).toMatchObject({
      ok: false,
      message: "Select a shorter passage (up to 10,000 characters).",
    });
  });
});
