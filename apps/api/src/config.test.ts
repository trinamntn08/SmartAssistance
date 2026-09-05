import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
describe("configuration", () => {
  it("reads documented quota and output limits", () => {
    expect(
      loadConfig({
        RATE_LIMIT_PER_MINUTE: "7",
        MAX_CONCURRENT_REWRITES: "2",
        OPENAI_MAX_OUTPUT_TOKENS: "4096",
      }),
    ).toMatchObject({ rateLimitPerMinute: 7, maxConcurrentRewrites: 2, maxOutputTokens: 4096 });
  });
  it("requires production credentials and explicit origins", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow("OPENAI_API_KEY");
    expect(() => loadConfig({ NODE_ENV: "production", OPENAI_API_KEY: "synthetic" })).toThrow(
      "SMARTASSISTANCE_API_TOKEN",
    );
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        OPENAI_API_KEY: "synthetic",
        SMARTASSISTANCE_API_TOKEN: "synthetic",
      }),
    ).toThrow("SMARTASSISTANCE_ALLOWED_ORIGINS");
  });
  it.each([
    { OPENAI_TIMEOUT_MS: "16000" },
    { OPENAI_MAX_OUTPUT_TOKENS: "0" },
    { SMARTASSISTANCE_ALLOWED_ORIGINS: "*" },
  ])("rejects unsafe settings %o", (env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
