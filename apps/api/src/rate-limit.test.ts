import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "./rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("bounds client memory without resetting active limits", () => {
    const limiter = new FixedWindowRateLimiter(1, 1000, 1);
    expect(limiter.consume("first", 0).allowed).toBe(true);
    expect(limiter.consume("second", 1).allowed).toBe(false);
    expect(limiter.consume("first", 2).allowed).toBe(false);
    expect(limiter.consume("second", 1000).allowed).toBe(true);
  });
  it("blocks requests beyond the window limit", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);

    expect(limiter.consume("client", 0).allowed).toBe(true);
    expect(limiter.consume("client", 100).allowed).toBe(true);
    expect(limiter.consume("client", 200)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("starts a new bucket after the window expires", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);

    expect(limiter.consume("client", 0).allowed).toBe(true);
    expect(limiter.consume("client", 999).allowed).toBe(false);
    expect(limiter.consume("client", 1_000).allowed).toBe(true);
  });
});
