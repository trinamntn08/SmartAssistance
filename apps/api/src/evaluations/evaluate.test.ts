import {
  MAX_REWRITE_CHARACTERS,
  MAX_REWRITTEN_CHARACTERS,
  REWRITE_OPERATIONS,
  REWRITE_TONES,
} from "@smartassistance/contracts";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "../errors.js";
import { REWRITE_PROMPT_VERSION } from "../rewrite-policy.js";
import type { RewriteProvider } from "../rewrite-service.js";
import { REWRITE_EVALUATION_CASES, type RewriteEvaluationCase } from "./cases.js";
import { evaluateRewrite, validateEvaluationCases } from "./evaluate.js";
import { EVALUATION_LIMITS, runEvaluationSuite, runLiveEvaluation } from "./run.js";

function fixture(id: string): RewriteEvaluationCase {
  const found = REWRITE_EVALUATION_CASES.find((candidate) => candidate.id === id);
  if (!found) throw new Error("Missing test fixture.");
  return found;
}

const names = fixture("grammar-names-identifiers");

describe("versioned rewrite corpus", () => {
  it("has valid requests and self-consistent invariants across modes and improvement styles", () => {
    expect(validateEvaluationCases(REWRITE_EVALUATION_CASES)).toEqual([]);
    expect(REWRITE_EVALUATION_CASES).toHaveLength(20);
    expect(new Set(REWRITE_EVALUATION_CASES.map((item) => item.request.operation))).toEqual(
      new Set(REWRITE_OPERATIONS),
    );
    expect(
      new Set(
        REWRITE_EVALUATION_CASES.flatMap((item) =>
          item.request.tone === undefined ? [] : [item.request.tone],
        ),
      ),
    ).toEqual(new Set(REWRITE_TONES));
    const long = fixture("grammar-near-limit");
    expect(long.request.text.length).toBeGreaterThanOrEqual(9000);
    expect(long.request.text.length).toBeLessThanOrEqual(MAX_REWRITE_CHARACTERS);
  });

  it("rejects duplicate IDs, invalid requests, and assertions inconsistent with their source", () => {
    const invalid: RewriteEvaluationCase = {
      ...names,
      request: { ...names.request, text: "" },
      humanReview: "",
      invariants: [
        { kind: "token", value: "absent" },
        { kind: "substring", value: "" },
      ],
    };
    expect(validateEvaluationCases([names, invalid])).toEqual(
      expect.arrayContaining([
        "case[1]: duplicate id",
        "case[1]: invalid request",
        "case[1]: missing human review guidance",
        "case[1] check[0]: inconsistent source",
        "case[1] check[1]: empty value",
      ]),
    );
    expect(
      validateEvaluationCases([
        { ...names, invariants: [{ kind: "forbidden", value: "Mira Chen" }] },
      ]),
    ).toEqual(["case[0] check[0]: inconsistent source"]);
  });
});

describe("deterministic preservation checks", () => {
  it("accepts a grammatical correction that preserves protected facts", () => {
    expect(
      evaluateRewrite(names, "Mira Chen has reviewed case PK-1042 and sent 17 comments.").passed,
    ).toBe(true);
  });

  it.each([
    ["name", "Mira Chen", "Mira Chan"],
    ["identifier", "PK-1042", "PK-1043"],
    ["number", "17", "18"],
    ["number suffix", "17", "170"],
    ["identifier suffix", "PK-1042", "PK-10420"],
  ])("detects an altered %s", (_label, before, after) => {
    const result = evaluateRewrite(names, names.request.text.replace(before, after));
    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ reason: "protected_count_changed" }),
    );
  });

  it("detects duplicated protected details", () => {
    expect(evaluateRewrite(names, `${names.request.text} There were 17 comments.`).passed).toBe(
      false,
    );
  });

  it("treats URL punctuation literally", () => {
    const item = fixture("grammar-links-email");
    expect(
      evaluateRewrite(
        item,
        item.request.text.replace("example.invalid/tasks", "exampleXinvalid/tasks"),
      ).passed,
    ).toBe(false);
    expect(
      evaluateRewrite(item, item.request.text.replace("?mode=review", "?mode=approve")).passed,
    ).toBe(false);
  });

  it("detects removed negation and a known stronger commitment", () => {
    const negative = fixture("grammar-negation");
    expect(
      evaluateRewrite(negative, negative.request.text.replace("did not approve", "approved"))
        .passed,
    ).toBe(false);
    const conditional = fixture("grammar-conditional-commitment");
    expect(
      evaluateRewrite(conditional, conditional.request.text.replace("I can send", "I will send"))
        .failures,
    ).toContainEqual(expect.objectContaining({ reason: "forbidden_text" }));
  });

  it("detects changed CJK and RTL names without imposing Latin word boundaries", () => {
    const japanese = fixture("improve-japanese");
    const arabic = fixture("improve-arabic");
    expect(
      evaluateRewrite(japanese, japanese.request.text.replace("田中葵", "田中花")).passed,
    ).toBe(false);
    expect(
      evaluateRewrite(arabic, arabic.request.text.replace("ليلى حسن", "ليلى أحمد")).passed,
    ).toBe(false);
  });

  it("preserves paragraph count across newline conventions and catches merged paragraphs", () => {
    const item = fixture("improve-paragraphs");
    expect(evaluateRewrite(item, item.request.text.replaceAll("\n", "\r\n")).passed).toBe(true);
    expect(
      evaluateRewrite(item, item.request.text.replaceAll("\n\n", " ")).failures,
    ).toContainEqual(expect.objectContaining({ reason: "paragraph_count_changed" }));
  });

  it("rejects empty or oversized output and never includes text in failure details", () => {
    const oversized = `${names.request.text} ${"s".repeat(MAX_REWRITTEN_CHARACTERS)}`;
    for (const output of [" ", oversized]) {
      const result = evaluateRewrite(names, output);
      expect(result.failures).toContainEqual({ check: "output", reason: "invalid_output" });
      expect(JSON.stringify(result)).not.toContain("Mira Chen");
    }
  });

  it("does not confuse passing preservation checks with successful rewriting", () => {
    // An unchanged, ungrammatical draft deliberately passes. Human review must catch it.
    expect(evaluateRewrite(names, names.request.text).passed).toBe(true);
  });
});

describe("bounded evaluation runner with fake providers", () => {
  it("runs sequentially, enforces the case cap, and reports metadata without draft content", async () => {
    let active = 0;
    let peak = 0;
    const rewrite = vi.fn<RewriteProvider["rewrite"]>(async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return {
        rewrittenText: request.text,
        model: "synthetic-model",
        promptVersion: REWRITE_PROMPT_VERSION,
        usage: { inputTokens: 10, outputTokens: 12 },
      };
    });
    const report = await runEvaluationSuite({ rewrite }, { model: "synthetic-model", maxCases: 3 });
    expect(peak).toBe(1);
    expect(rewrite).toHaveBeenCalledTimes(3);
    expect(report).toMatchObject({
      complete: true,
      passed: true,
      plannedCases: 3,
      knownUsage: { inputTokens: 30, outputTokens: 36 },
    });
    expect(report.cases.every((item) => item.durationMs >= 0)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("Mira Chen");
    expect(JSON.stringify(report)).not.toContain("rewrittenText");
  });

  it("records preservation failures and provider error codes without leaking exception content", async () => {
    const rewrite = vi
      .fn<RewriteProvider["rewrite"]>()
      .mockResolvedValueOnce({
        model: "synthetic-model",
        rewrittenText: names.request.text.replace("17", "18"),
      })
      .mockRejectedValueOnce(new AppError("INCOMPLETE_OUTPUT", "PRIVATE_SYNTHETIC_DRAFT", 502))
      .mockRejectedValueOnce(new Error("PRIVATE_SYNTHETIC_PROVIDER_BODY"));
    const report = await runEvaluationSuite({ rewrite }, { model: "synthetic-model", maxCases: 3 });
    expect(report.complete).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.failedInvariants).toBe(1);
    expect(report.cases[1]?.errorCode).toBe("INCOMPLETE_OUTPUT");
    expect(report.cases[2]?.errorCode).toBe("EVALUATION_ERROR");
    expect(JSON.stringify(report)).not.toContain("PRIVATE_SYNTHETIC");
    expect(rewrite).toHaveBeenCalledTimes(3);
  });

  it("stops on cancellation without a retry or the next case", async () => {
    const controller = new AbortController();
    const rewrite = vi.fn<RewriteProvider["rewrite"]>(async (_request, signal) => {
      controller.abort();
      signal?.throwIfAborted();
      throw new Error("Unreachable");
    });
    const report = await runEvaluationSuite(
      { rewrite },
      { model: "synthetic-model", signal: controller.signal },
    );
    expect(rewrite).toHaveBeenCalledOnce();
    expect(report.complete).toBe(false);
    expect(report.cases[0]?.errorCode).toBe("CANCELLED");
  });

  it("propagates its total deadline and stops the suite", async () => {
    const rewrite = vi.fn<RewriteProvider["rewrite"]>(
      async (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("Synthetic cancellation")), {
            once: true,
          });
          if (signal?.aborted) reject(new Error("Synthetic cancellation"));
        }),
    );
    const report = await runEvaluationSuite(
      { rewrite },
      { model: "synthetic-model", maxDurationMs: 20 },
    );
    expect(rewrite).toHaveBeenCalledOnce();
    expect(report.complete).toBe(false);
    expect(report.cases[0]?.errorCode).toBe("TIMEOUT");
  });

  it("rejects excessive budgets or an invalid corpus before any call", async () => {
    const rewrite = vi.fn<RewriteProvider["rewrite"]>();
    await expect(
      runEvaluationSuite(
        { rewrite },
        { model: "synthetic-model", maxCases: EVALUATION_LIMITS.maxCases + 1 },
      ),
    ).rejects.toThrow("limits");
    await expect(
      runEvaluationSuite(
        { rewrite },
        { model: "synthetic-model", maxDurationMs: EVALUATION_LIMITS.maxDurationMs + 1 },
      ),
    ).rejects.toThrow("limits");
    await expect(
      runEvaluationSuite(
        { rewrite },
        { model: "synthetic-model", fixtures: [{ ...names, invariants: [] }] },
      ),
    ).rejects.toThrow("corpus");
    expect(rewrite).not.toHaveBeenCalled();
  });

  it("requires exact explicit live opt-in and a key before creating a live provider", async () => {
    await expect(runLiveEvaluation({})).rejects.toThrow("RUN_LIVE_REWRITE_EVALS=1");
    await expect(runLiveEvaluation({ RUN_LIVE_REWRITE_EVALS: "true" })).rejects.toThrow(
      "RUN_LIVE_REWRITE_EVALS=1",
    );
    await expect(runLiveEvaluation({ RUN_LIVE_REWRITE_EVALS: "1" })).rejects.toThrow(
      "OPENAI_API_KEY",
    );
    await expect(
      runLiveEvaluation({
        RUN_LIVE_REWRITE_EVALS: "1",
        OPENAI_API_KEY: "synthetic-key",
        REWRITE_EVAL_MAX_CASES: "21",
      }),
    ).rejects.toThrow("REWRITE_EVAL_MAX_CASES");
  });
});
