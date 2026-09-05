import { describe, expect, it } from "vitest";

import { MAX_REWRITE_CHARACTERS, isRewriteResponse, parseRewriteRequest } from "./index.js";

describe("parseRewriteRequest", () => {
  it("accepts a valid same-language rewrite", () => {
    const result = parseRewriteRequest({
      text: "pls send it tomorrow",
      operation: "rephrase",
      tone: "natural",
      targetLanguage: "same",
    });

    expect(result).toEqual({
      success: true,
      value: {
        text: "pls send it tomorrow",
        operation: "rephrase",
        tone: "natural",
        targetLanguage: "same",
      },
    });
  });

  it("rejects unexpected fields", () => {
    const result = parseRewriteRequest({
      text: "Hello",
      operation: "rephrase",
      tone: "natural",
      targetLanguage: "en",
      pageContent: "must not be accepted",
    });

    expect(result).toEqual({ success: false, message: "Unexpected field: pageContent." });
  });

  it("rejects an oversized draft", () => {
    const result = parseRewriteRequest({
      text: "a".repeat(MAX_REWRITE_CHARACTERS + 1),
      operation: "grammar",
      tone: "formal",
      targetLanguage: "en-US",
    });

    expect(result.success).toBe(false);
  });
});

describe("isRewriteResponse", () => {
  it("accepts the provider-neutral response contract", () => {
    expect(
      isRewriteResponse({
        rewrittenText: "Please send it tomorrow.",
        requestId: "request-1",
        model: "test-model",
      }),
    ).toBe(true);
  });

  it("rejects an empty rewrite", () => {
    expect(
      isRewriteResponse({ rewrittenText: " ", requestId: "request-1", model: "test-model" }),
    ).toBe(false);
  });
});
