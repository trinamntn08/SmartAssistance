import { MAX_REWRITTEN_CHARACTERS, parseRewriteRequest } from "@smartassistance/contracts";

import type { RewriteEvaluationCase, RewriteInvariant } from "./cases.js";

export interface EvaluationFailure {
  check: "output" | number;
  reason:
    | "invalid_output"
    | "protected_count_changed"
    | "forbidden_text"
    | "paragraph_count_changed";
}

export interface EvaluationResult {
  passed: boolean;
  checks: number;
  failures: EvaluationFailure[];
}

function occurrences(text: string, value: string, token: boolean): number {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Digits and identifiers must not match inside larger Unicode words/numbers.
  const pattern = token ? `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])` : escaped;
  return Array.from(text.matchAll(new RegExp(pattern, "gu"))).length;
}

function paragraphCount(text: string): number {
  return text.trim().split(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/).length;
}

function checkInvariant(
  invariant: RewriteInvariant,
  source: string,
  output: string,
): EvaluationFailure["reason"] | undefined {
  switch (invariant.kind) {
    case "substring":
    case "token":
      return occurrences(source, invariant.value, invariant.kind === "token") ===
        occurrences(output, invariant.value, invariant.kind === "token")
        ? undefined
        : "protected_count_changed";
    case "forbidden":
      return output.includes(invariant.value) ? "forbidden_text" : undefined;
    case "paragraphs":
      return paragraphCount(source) === paragraphCount(output)
        ? undefined
        : "paragraph_count_changed";
  }
}

/** Narrow preservation checks, not a semantic or language-quality score. */
export function evaluateRewrite(fixture: RewriteEvaluationCase, output: string): EvaluationResult {
  const failures: EvaluationFailure[] = [];
  if (!output.trim() || output.length > MAX_REWRITTEN_CHARACTERS) {
    failures.push({ check: "output", reason: "invalid_output" });
  }
  fixture.invariants.forEach((invariant, index) => {
    const reason = checkInvariant(invariant, fixture.request.text, output);
    if (reason) failures.push({ check: index, reason });
  });
  return { passed: failures.length === 0, checks: fixture.invariants.length + 1, failures };
}

/** Validate the corpus before spending tokens. Diagnostics contain only IDs and indices. */
export function validateEvaluationCases(fixtures: readonly RewriteEvaluationCase[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const [index, fixture] of fixtures.entries()) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixture.id)) {
      issues.push(`case[${index}]: invalid id`);
    }
    if (ids.has(fixture.id)) issues.push(`case[${index}]: duplicate id`);
    ids.add(fixture.id);
    if (!parseRewriteRequest(fixture.request).success)
      issues.push(`case[${index}]: invalid request`);
    if (!fixture.humanReview.trim()) issues.push(`case[${index}]: missing human review guidance`);
    if (!fixture.invariants.length) issues.push(`case[${index}]: missing invariants`);
    fixture.invariants.forEach((invariant, check) => {
      if (invariant.kind === "paragraphs") return;
      if (!invariant.value.trim()) {
        issues.push(`case[${index}] check[${check}]: empty value`);
        return;
      }
      const count = occurrences(fixture.request.text, invariant.value, invariant.kind === "token");
      if (
        (invariant.kind === "forbidden" && count !== 0) ||
        (invariant.kind !== "forbidden" && count === 0)
      ) {
        issues.push(`case[${index}] check[${check}]: inconsistent source`);
      }
    });
  }
  return issues;
}
