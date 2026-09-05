// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyRewrite, captureFocusedEditor, clearEditorSnapshot, undoRewrite } from "./editor.js";
import { SNAPSHOT_TTL_MS } from "./messages.js";

describe("editor integration", () => {
  afterEach(() => {
    clearEditorSnapshot();
    vi.useRealTimers();
  });
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("captures, replaces, emits input events, and restores a textarea", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "hello there";
    const inputListener = vi.fn();
    textarea.addEventListener("input", inputListener);
    document.body.append(textarea);
    textarea.focus();

    const captured = captureFocusedEditor(document);
    expect(captured.ok).toBe(true);
    if (!captured.ok || !("draft" in captured)) {
      throw new Error("Expected a captured draft.");
    }

    expect(applyRewrite(captured.draft.snapshotId, "Hello there.")).toEqual({
      applied: true,
      ok: true,
    });
    expect(textarea.value).toBe("Hello there.");
    expect(inputListener).toHaveBeenCalledOnce();

    expect(undoRewrite(captured.draft.snapshotId)).toEqual({ ok: true, undone: true });
    expect(textarea.value).toBe("hello there");
  });

  it("does not overwrite a draft that changed after capture", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "first draft";
    document.body.append(input);
    input.focus();

    const captured = captureFocusedEditor(document);
    if (!captured.ok || !("draft" in captured)) {
      throw new Error("Expected a captured draft.");
    }

    input.value = "user kept typing";
    expect(applyRewrite(captured.draft.snapshotId, "model output")).toMatchObject({
      code: "CONFLICT",
      ok: false,
    });
    expect(input.value).toBe("user kept typing");
  });

  it("rejects password fields", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "not-for-the-model";
    document.body.append(input);
    input.focus();

    expect(captureFocusedEditor(document)).toMatchObject({
      code: "INVALID_REQUEST",
      ok: false,
    });
  });

  it.each([
    "cc-number",
    "section-checkout cc-csc",
    "one-time-code",
    "current-password",
    "CC-NUMBER",
    "CURRENT-PASSWORD",
  ])("rejects sensitive autocomplete %s", (autocomplete) => {
    const input = document.createElement("input");
    input.setAttribute("autocomplete", autocomplete);
    input.value = "synthetic value";
    document.body.append(input);
    input.focus();
    expect(captureFocusedEditor()).toMatchObject({ ok: false });
  });

  it("replaces email input without throwing and retains undo", () => {
    const input = document.createElement("input");
    input.type = "email";
    input.value = "before@example.com";
    const listener = vi.fn();
    input.addEventListener("input", listener);
    document.body.append(input);
    input.focus();
    const captured = captureFocusedEditor();
    if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
    expect(applyRewrite(captured.draft.snapshotId, "after@example.com")).toMatchObject({
      ok: true,
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(undoRewrite(captured.draft.snapshotId)).toMatchObject({ ok: true });
    expect(input.value).toBe("before@example.com");
  });

  it.each(["readonly", "disabled", "hidden", "payment"])(
    "rechecks %s before applying",
    (change) => {
      const input = document.createElement("input");
      input.value = "original";
      document.body.append(input);
      input.focus();
      const captured = captureFocusedEditor();
      if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
      if (change === "readonly") input.readOnly = true;
      if (change === "disabled") input.disabled = true;
      if (change === "hidden") input.style.display = "none";
      if (change === "payment") input.autocomplete = "cc-number";
      expect(applyRewrite(captured.draft.snapshotId, "replacement")).toMatchObject({
        ok: false,
        code: "CONFLICT",
      });
      expect(input.value).toBe("original");
    },
  );

  it("clears expired captures and refuses both replacement and undo", () => {
    vi.useFakeTimers();
    const input = document.createElement("textarea");
    input.value = "original";
    document.body.append(input);
    input.focus();
    const captured = captureFocusedEditor();
    if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
    vi.advanceTimersByTime(SNAPSHOT_TTL_MS);
    expect(applyRewrite(captured.draft.snapshotId, "new")).toMatchObject({ ok: false });
    expect(undoRewrite(captured.draft.snapshotId)).toMatchObject({ ok: false });
  });

  it("treats model markup as text and restores original contenteditable nodes", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.tabIndex = 0;
    editor.innerHTML = "<b>original</b>";
    const originalNode = editor.firstChild;
    document.body.append(editor);
    editor.focus();
    const captured = captureFocusedEditor();
    if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
    expect(
      applyRewrite(captured.draft.snapshotId, "<script>test</script>\nsecond paragraph"),
    ).toMatchObject({ ok: true });
    expect(editor.querySelector("script")).toBeNull();
    expect(editor.textContent).toContain("\nsecond paragraph");
    expect(undoRewrite(captured.draft.snapshotId)).toMatchObject({ ok: true });
    expect(editor.firstChild).toBe(originalNode);
    expect(editor.innerHTML).toBe("<b>original</b>");
  });

  it("rejects undo after subsequent user edits", () => {
    const input = document.createElement("textarea");
    input.value = "original";
    document.body.append(input);
    input.focus();
    const captured = captureFocusedEditor();
    if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
    applyRewrite(captured.draft.snapshotId, "replacement");
    input.value = "user changed this";
    expect(undoRewrite(captured.draft.snapshotId)).toMatchObject({ ok: false });
    expect(input.value).toBe("user changed this");
  });

  it.each(["text", "attributes"])(
    "rejects undo when the page mutates detached original %s",
    (change) => {
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      editor.tabIndex = 0;
      editor.innerHTML = "<b>original</b>";
      const originalNode = editor.firstElementChild;
      if (!originalNode) throw new Error("No original node");
      document.body.append(editor);
      editor.focus();
      const captured = captureFocusedEditor();
      if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
      applyRewrite(captured.draft.snapshotId, "replacement");
      if (change === "text") originalNode.textContent = "Changed by the page";
      else originalNode.setAttribute("onclick", "pageAction()");
      const inputListener = vi.fn();
      editor.addEventListener("input", inputListener);

      expect(undoRewrite(captured.draft.snapshotId)).toMatchObject({ ok: false, code: "CONFLICT" });
      expect(editor.textContent).toBe("replacement");
      expect(originalNode.parentNode).toBeNull();
      expect(inputListener).not.toHaveBeenCalled();
    },
  );

  it.each(["connected", "detached"])(
    "does not steal original nodes reparented into a %s container",
    (location) => {
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      editor.tabIndex = 0;
      editor.innerHTML = "<b>original</b>";
      const originalNode = editor.firstChild;
      if (!originalNode) throw new Error("No original node");
      document.body.append(editor);
      editor.focus();
      const captured = captureFocusedEditor();
      if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
      applyRewrite(captured.draft.snapshotId, "replacement");
      const otherContainer = document.createElement("div");
      if (location === "connected") document.body.append(otherContainer);
      otherContainer.append(originalNode);

      expect(undoRewrite(captured.draft.snapshotId)).toMatchObject({ ok: false, code: "CONFLICT" });
      expect(editor.textContent).toBe("replacement");
      expect(otherContainer.firstChild).toBe(originalNode);
    },
  );

  it("rejects undo when detached original nodes have been adopted by another document", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.tabIndex = 0;
    editor.innerHTML = "<b>original</b>";
    const originalNode = editor.firstChild;
    if (!originalNode) throw new Error("No original node");
    document.body.append(editor);
    editor.focus();
    const captured = captureFocusedEditor();
    if (!captured.ok || !("draft" in captured)) throw new Error("No capture");
    applyRewrite(captured.draft.snapshotId, "replacement");
    const otherDocument = document.implementation.createHTMLDocument();
    otherDocument.adoptNode(originalNode);

    expect(undoRewrite(captured.draft.snapshotId)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(editor.textContent).toBe("replacement");
    expect(originalNode.ownerDocument).toBe(otherDocument);
    expect(originalNode.parentNode).toBeNull();
  });
});
