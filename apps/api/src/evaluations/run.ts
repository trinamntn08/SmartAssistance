import { pathToFileURL } from "node:url";

import { loadConfig } from "../config.js";
import { AppError } from "../errors.js";
import { OpenAIRewriteProvider } from "../openai-rewrite-provider.js";
import { REWRITE_PROMPT_VERSION } from "../rewrite-policy.js";
import { type RewriteProvider, RewriteService } from "../rewrite-service.js";
import {
  REWRITE_EVALUATION_CASES,
  REWRITE_EVALUATION_VERSION,
  type RewriteEvaluationCase,
} from "./cases.js";
import { type EvaluationFailure, evaluateRewrite, validateEvaluationCases } from "./evaluate.js";

export const EVALUATION_LIMITS = {
  maxCases: 20,
  maxOutputTokensPerCase: 8192,
  maxDurationMs: 300_000,
} as const;

export interface EvaluationCaseReport {
  id: string;
  passed: boolean;
  model: string;
  promptVersion: string;
  durationMs: number;
  checks: number;
  failures: EvaluationFailure[];
  errorCode?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface EvaluationReport {
  corpusVersion: string;
  limits: { maxCases: number; maxDurationMs: number };
  generation?: { maxOutputTokens: number; providerTimeoutMs: number };
  complete: boolean;
  passed: boolean;
  plannedCases: number;
  cases: EvaluationCaseReport[];
  checkedInvariants: number;
  failedInvariants: number;
  knownUsage: { inputTokens: number; outputTokens: number };
}

interface EvaluationOptions {
  model: string;
  maxCases?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
  fixtures?: readonly RewriteEvaluationCase[];
}

function positiveBoundedInteger(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= maximum;
}

/** Runs sequentially through the provider boundary. Does not persist drafts or rewrites. */
export async function runEvaluationSuite(
  provider: RewriteProvider,
  options: EvaluationOptions,
): Promise<EvaluationReport> {
  const maxCases = options.maxCases ?? EVALUATION_LIMITS.maxCases;
  const duration = options.maxDurationMs ?? EVALUATION_LIMITS.maxDurationMs;
  if (
    !positiveBoundedInteger(maxCases, EVALUATION_LIMITS.maxCases) ||
    !positiveBoundedInteger(duration, EVALUATION_LIMITS.maxDurationMs)
  ) {
    throw new Error("Evaluation limits are invalid.");
  }
  const fixtures = options.fixtures ?? REWRITE_EVALUATION_CASES;
  if (!fixtures.length || validateEvaluationCases(fixtures).length) {
    throw new Error("Evaluation corpus is invalid.");
  }
  const selected = fixtures.slice(0, maxCases);
  const deadline = AbortSignal.timeout(duration);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  const service = new RewriteService(provider);
  const report: EvaluationReport = {
    corpusVersion: REWRITE_EVALUATION_VERSION,
    limits: { maxCases, maxDurationMs: duration },
    complete: false,
    passed: false,
    plannedCases: selected.length,
    cases: [],
    checkedInvariants: 0,
    failedInvariants: 0,
    knownUsage: { inputTokens: 0, outputTokens: 0 },
  };
  for (const fixture of selected) {
    if (signal.aborted) break;
    const started = performance.now();
    let result: EvaluationCaseReport;
    try {
      const rewrite = await service.execute(fixture.request, `eval-${fixture.id}`, signal);
      const evaluation = evaluateRewrite(fixture, rewrite.rewrittenText);
      result = {
        id: fixture.id,
        ...evaluation,
        model: rewrite.model,
        promptVersion: rewrite.promptVersion ?? REWRITE_PROMPT_VERSION,
        durationMs: Math.round(performance.now() - started),
        ...(rewrite.usage ? { usage: rewrite.usage } : {}),
      };
    } catch (error) {
      result = {
        id: fixture.id,
        passed: false,
        model: options.model,
        promptVersion: REWRITE_PROMPT_VERSION,
        durationMs: Math.round(performance.now() - started),
        checks: 0,
        failures: [],
        errorCode: signal.aborted
          ? deadline.aborted
            ? "TIMEOUT"
            : "CANCELLED"
          : error instanceof AppError
            ? error.code
            : "EVALUATION_ERROR",
      };
    }
    report.cases.push(result);
    report.checkedInvariants += result.checks;
    report.failedInvariants += result.failures.length;
    report.knownUsage.inputTokens += result.usage?.inputTokens ?? 0;
    report.knownUsage.outputTokens += result.usage?.outputTokens ?? 0;
  }
  report.complete = report.cases.length === selected.length && !signal.aborted;
  report.passed = report.complete && report.cases.every((result) => result.passed);
  return report;
}

function readLimit(env: NodeJS.ProcessEnv, key: string, fallback: number, maximum: number): number {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!positiveBoundedInteger(value, maximum)) throw new Error(`Invalid ${key}.`);
  return value;
}

/** Explicit opt-in is checked before constructing the live provider. */
export async function runLiveEvaluation(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EvaluationReport> {
  if (env.RUN_LIVE_REWRITE_EVALS !== "1") {
    throw new Error("Set RUN_LIVE_REWRITE_EVALS=1 to authorize paid synthetic provider requests.");
  }
  const config = loadConfig(env);
  if (!config.openAIKey) throw new Error("OPENAI_API_KEY is required for live evaluations.");
  const maxCases = readLimit(
    env,
    "REWRITE_EVAL_MAX_CASES",
    EVALUATION_LIMITS.maxCases,
    EVALUATION_LIMITS.maxCases,
  );
  const maxDurationMs = readLimit(
    env,
    "REWRITE_EVAL_TIMEOUT_MS",
    EVALUATION_LIMITS.maxDurationMs,
    EVALUATION_LIMITS.maxDurationMs,
  );
  const maxOutputTokens = Math.min(
    config.maxOutputTokens,
    readLimit(
      env,
      "REWRITE_EVAL_MAX_OUTPUT_TOKENS",
      EVALUATION_LIMITS.maxOutputTokensPerCase,
      EVALUATION_LIMITS.maxOutputTokensPerCase,
    ),
  );
  const provider = new OpenAIRewriteProvider({
    apiKey: config.openAIKey,
    model: config.model,
    timeoutMs: config.providerTimeoutMs,
    maxOutputTokens,
  });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const report = await runEvaluationSuite(provider, {
      model: config.model,
      maxCases,
      maxDurationMs,
      signal: controller.signal,
    });
    return {
      ...report,
      generation: { maxOutputTokens, providerTimeoutMs: config.providerTimeoutMs },
    };
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runLiveEvaluation();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.passed ? 0 : 1;
  } catch {
    // Configuration and provider errors may carry request details. Never print their objects.
    process.stderr.write(
      "Evaluation setup failed. Check explicit opt-in, API key, and evaluation limits.\n",
    );
    process.exitCode = 1;
  }
}
