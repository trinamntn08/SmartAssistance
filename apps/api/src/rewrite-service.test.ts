import { describe, expect, it } from "vitest";

import type { AppError } from "./errors.js";
import { RewriteService, type RewriteProvider } from "./rewrite-service.js";

const request = {
  operation: "rephrase" as const,
  targetLanguage: "same",
  text: "send this tomorrow pls",
  tone: "natural" as const,
};

describe("RewriteService", () => {
  it("returns a provider-neutral response", async () => {
    const provider: RewriteProvider = {
      async rewrite() {
        return { model: "fake-model", rewrittenText: "Please send this tomorrow." };
      },
    };

    await expect(new RewriteService(provider).execute(request, "request-1")).resolves.toEqual({
      model: "fake-model",
      requestId: "request-1",
      rewrittenText: "Please send this tomorrow.",
    });
  });

  it("rejects empty provider output", async () => {
    const provider: RewriteProvider = {
      async rewrite() {
        return { model: "fake-model", rewrittenText: " " };
      },
    };

    await expect(new RewriteService(provider).execute(request, "request-1")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      statusCode: 502,
    } satisfies Partial<AppError>);
  });
});
