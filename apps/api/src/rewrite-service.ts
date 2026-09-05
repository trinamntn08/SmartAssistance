import {
  MAX_REWRITTEN_CHARACTERS,
  type RewriteRequest,
  type RewriteResponse,
} from "@smartassistance/contracts";

import { AppError } from "./errors.js";

export interface ProviderRewriteResult {
  model: string;
  rewrittenText: string;
  detectedLanguage?: string;
  promptVersion?: string;
  providerRequestId?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface RewriteProvider {
  rewrite(request: RewriteRequest, signal?: AbortSignal): Promise<ProviderRewriteResult>;
}

export class RewriteService {
  constructor(private readonly provider: RewriteProvider) {}

  async execute(
    request: RewriteRequest,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<
    RewriteResponse & Pick<ProviderRewriteResult, "promptVersion" | "providerRequestId" | "usage">
  > {
    signal?.throwIfAborted();
    const result = await this.provider.rewrite(request, signal);
    signal?.throwIfAborted();
    const rewrittenText = result.rewrittenText.trim();

    if (rewrittenText.length === 0 || rewrittenText.length > MAX_REWRITTEN_CHARACTERS) {
      throw new AppError(
        "PROVIDER_ERROR",
        "The writing provider returned an invalid result. Please try again.",
        502,
      );
    }

    return {
      rewrittenText,
      requestId,
      model: result.model,
      ...(result.promptVersion ? { promptVersion: result.promptVersion } : {}),
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.detectedLanguage ? { detectedLanguage: result.detectedLanguage } : {}),
    };
  }
}
