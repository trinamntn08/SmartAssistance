// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
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
    '<div autocomplete="cc-number"><p id="chosen">synthetic</p></div>',
    '<div id="chosen">Public <span autocomplete="one-time-code">synthetic</span></div>',
    '<div id="chosen">Public <span inert>synthetic</span></div>',
    '<textarea id="chosen" readonly>private</textarea>',
  ])("excludes sensitive and unavailable selection %s", (html) => {
    document.body.innerHTML = html;
    selectContents("#chosen");
    expect(captureSelection()).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
  it.each(["aria-hidden", "aria-readonly", "aria-disabled"])(
    "captures visibly rendered text marked %s",
    (attribute) => {
      document.body.innerHTML = `<div ${attribute}="true"><p id="chosen">Bonjour</p></div>`;
      selectContents("#chosen");
      expect(captureSelection()).toMatchObject({ ok: true, draft: { text: "Bonjour" } });
    },
  );
  it("uses the browser's rendered selection across hidden widgets and controls", () => {
    document.body.innerHTML =
      '<div id="chosen">Bonjour<span hidden>secret</span><input autocomplete="cc-number" value="secret"><textarea>secret</textarea> monde</div>';
    selectContents("#chosen");
    // jsdom uses Range text rather than Chromium's rendered Selection string.
    const selection = document.getSelection();
    if (!selection) throw new Error("Missing selection");
    vi.spyOn(selection, "toString").mockReturnValue("Bonjour monde");
    expect(captureSelection()).toMatchObject({ ok: true, draft: { text: "Bonjour monde" } });
  });
  it.each(["textarea", 'input type="text"'])(
    "reads only an explicit selected field substring: %s",
    (tag) => {
      document.body.innerHTML =
        tag === "textarea"
          ? "<textarea readonly>Outside Bonjour Outside</textarea>"
          : '<input type="text" readonly value="Outside Bonjour Outside">';
      const field = document.querySelector("input, textarea") as
        | HTMLInputElement
        | HTMLTextAreaElement;
      field.focus();
      field.setSelectionRange(8, 15);
      expect(captureSelection()).toMatchObject({ ok: true, draft: { text: "Bonjour" } });
      expect(captureSelection(document, true)).toEqual({ ok: true, empty: true });
    },
  );
  it.each(['type="password"', 'autocomplete="cc-number"', 'autocomplete="one-time-code"'])(
    "rejects explicit sensitive/unavailable fields: %s",
    (attributes) => {
      document.body.innerHTML = `<input ${attributes} value="synthetic">`;
      const field = document.querySelector("input");
      if (!field) throw new Error("Missing field");
      field.focus();
      field.setSelectionRange(0, 9);
      expect(captureSelection()).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    },
  );
  it("rejects oversized text without truncating", () => {
    document.body.innerHTML = `<p id="chosen">${"a".repeat(10_001)}</p>`;
    selectContents("#chosen");
    expect(captureSelection()).toMatchObject({
      ok: false,
      message: "Select a shorter passage (up to 10,000 characters).",
    });
  });
  it("checks sensitive ancestors across shadow hosts for explicit field selections", () => {
    const host = document.createElement("div");
    host.setAttribute("autocomplete", "cc-number");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<input value="synthetic">';
    const field = root.querySelector("input");
    if (!field) throw new Error("Missing field");
    field.focus();
    field.setSelectionRange(0, 9);
    expect(captureSelection()).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    host.removeAttribute("autocomplete");
    expect(captureSelection()).toMatchObject({ ok: true, draft: { text: "synthetic" } });
  });
  it("applies the length cap to explicit field selections", () => {
    const field = document.createElement("textarea");
    field.value = "a".repeat(10_001);
    document.body.append(field);
    field.focus();
    field.select();
    expect(captureSelection()).toMatchObject({
      ok: false,
      message: "Select a shorter passage (up to 10,000 characters).",
    });
  });
});
