import type { RewriteRequest } from "@smartassistance/contracts";
import OpenAI from "openai";

import { AppError } from "./errors.js";
import { REWRITE_PROMPT_VERSION, rewriteInstructions } from "./rewrite-policy.js";
import type { ProviderRewriteResult, RewriteProvider } from "./rewrite-service.js";

export interface OpenAIRewriteProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens?: number;
  fetch?: typeof fetch;
}

export class OpenAIRewriteProvider implements RewriteProvider {
  readonly #client: OpenAI;
  constructor(private readonly options: OpenAIRewriteProviderOptions) {
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 0,
      logLevel: "off",
      timeout: options.timeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async rewrite(
    request: RewriteRequest,
    callerSignal?: AbortSignal,
  ): Promise<ProviderRewriteResult> {
    const deadline = AbortSignal.timeout(this.options.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    try {
      signal.throwIfAborted();
      const response = await this.#client.responses.create(
        {
          input: request.text,
          instructions: rewriteInstructions(request),
          max_output_tokens: this.options.maxOutputTokens ?? 8192,
          model: this.options.model,
          store: false,
        },
        { signal },
      );
      signal.throwIfAborted();
      if (
        response.output.some(
          (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
        )
      ) {
        throw new AppError(
          "REFUSED",
          "The provider could not rewrite this draft. Your original is unchanged.",
          422,
        );
      }
      if (response.status === "incomplete") {
        throw new AppError(
          "INCOMPLETE_OUTPUT",
          "The provider did not finish the rewrite. Try a shorter draft.",
          502,
        );
      }
      if (response.status !== "completed" || !response.output_text?.trim()) {
        throw new AppError(
          "PROVIDER_ERROR",
          "The provider returned no complete rewrite. Please try again.",
          502,
        );
      }
      return {
        model: response.model,
        rewrittenText: response.output_text,
        promptVersion: REWRITE_PROMPT_VERSION,
        ...(response._request_id ? { providerRequestId: response._request_id } : {}),
        ...(response.usage
          ? {
              usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
              },
            }
          : {}),
      };
    } catch (error) {
      if (callerSignal?.aborted) throw new AppError("CANCELLED", "The rewrite was cancelled.", 499);
      if (deadline.aborted || error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new AppError("TIMEOUT", "The provider timed out. Please try again.", 504);
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        "PROVIDER_ERROR",
        "The writing provider is temporarily unavailable. Please try again.",
        502,
        { cause: error },
      );
    }
  }
}

export class UnavailableRewriteProvider implements RewriteProvider {
  async rewrite(_request: RewriteRequest): Promise<ProviderRewriteResult> {
    throw new AppError(
      "CONFIGURATION_ERROR",
      "The API is missing OPENAI_API_KEY. Configure it and restart the server.",
      503,
    );
  }
}
