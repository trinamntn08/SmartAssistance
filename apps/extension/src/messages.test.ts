import { describe, expect, it } from "vitest";
import {
  isActiveDraftState,
  isContentScriptRequest,
  isContentScriptResponse,
  isExtensionRequest,
  isExtensionResponse,
} from "./messages.js";
describe("message boundaries", () => {
  it.each([
    null,
    {},
    { ok: true },
    { ok: true, draft: {} },
    { ok: false, code: "OTHER", message: "bad" },
  ])("rejects malformed editor responses %o", (value) => {
    expect(isContentScriptResponse(value)).toBe(false);
  });
  it("rejects malformed stored state and unknown API codes", () => {
    expect(isActiveDraftState({ status: "ready", draft: {}, tabId: 1 })).toBe(false);
    expect(
      isActiveDraftState({ status: "capturing", draft: { text: "legacy private text" } }),
    ).toBe(false);
    expect(
      isActiveDraftState({
        status: "error",
        message: "failed",
        draft: { text: "legacy private text" },
      }),
    ).toBe(false);
    expect(isExtensionResponse({ ok: false, code: "invented", message: "bad" })).toBe(false);
  });
  it("requires generation identity and prevents callers from supplying draft text", () => {
    expect(
      isExtensionRequest({
        type: "RUN_REWRITE",
        snapshotId: "s",
        generationId: "g",
        settings: { operation: "grammar", tone: "natural", targetLanguage: "same" },
      }),
    ).toBe(true);
    expect(
      isExtensionRequest({
        type: "RUN_REWRITE",
        snapshotId: "s",
        generationId: "g",
        settings: {
          operation: "grammar",
          tone: "natural",
          targetLanguage: "same",
          text: "injected",
        },
      }),
    ).toBe(false);
    expect(
      isExtensionRequest({ type: "APPLY_ACTIVE_REWRITE", snapshotId: "s", text: "rewrite" }),
    ).toBe(false);
    expect(isExtensionRequest({ type: "CLEAR_PRIVATE_DATA", text: "hidden extra" })).toBe(false);
    expect(isContentScriptRequest({ type: "APPLY_REWRITE", snapshotId: "s", text: 42 })).toBe(
      false,
    );
    expect(
      isContentScriptResponse({ ok: true, applied: true, draft: { text: "hidden extra" } }),
    ).toBe(false);
  });
});
