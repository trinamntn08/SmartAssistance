export const REWRITE_OPERATIONS = ["rephrase", "grammar", "concise", "translate"] as const;
export const REWRITE_TONES = ["natural", "formal", "casual"] as const;
export const MAX_REWRITE_CHARACTERS = 10_000;
export const MAX_REWRITTEN_CHARACTERS = 20_000;

export type RewriteOperation = (typeof REWRITE_OPERATIONS)[number];
export type RewriteTone = (typeof REWRITE_TONES)[number];

export interface RewriteRequest {
  text: string;
  operation: RewriteOperation;
  tone: RewriteTone;
  targetLanguage: string;
}

export interface RewriteResponse {
  rewrittenText: string;
  requestId: string;
  model: string;
  detectedLanguage?: string;
}

export const API_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "CONFIGURATION_ERROR",
  "CONFLICT",
  "INVALID_REQUEST",
  "METHOD_NOT_ALLOWED",
  "NOT_FOUND",
  "PROVIDER_ERROR",
  "RATE_LIMITED",
  "CANCELLED",
  "TIMEOUT",
  "INCOMPLETE_OUTPUT",
  "REFUSED",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return isOneOf(value, API_ERROR_CODES);
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
}

export type ParseResult<T> = { success: true; value: T } | { success: false; message: string };

const REQUEST_KEYS = new Set(["text", "operation", "tone", "targetLanguage"]);
const LANGUAGE_TAG = /^(same|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

export function parseRewriteRequest(input: unknown): ParseResult<RewriteRequest> {
  if (!isRecord(input)) {
    return { success: false, message: "Request body must be a JSON object." };
  }

  const unexpectedKey = Object.keys(input).find((key) => !REQUEST_KEYS.has(key));
  if (unexpectedKey) {
    return { success: false, message: `Unexpected field: ${unexpectedKey}.` };
  }

  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    return { success: false, message: "Text must be a non-empty string." };
  }

  if (input.text.length > MAX_REWRITE_CHARACTERS) {
    return {
      success: false,
      message: `Text must contain at most ${MAX_REWRITE_CHARACTERS} characters.`,
    };
  }

  if (!isOneOf(input.operation, REWRITE_OPERATIONS)) {
    return { success: false, message: "Operation is not supported." };
  }

  if (!isOneOf(input.tone, REWRITE_TONES)) {
    return { success: false, message: "Tone is not supported." };
  }

  if (typeof input.targetLanguage !== "string" || !LANGUAGE_TAG.test(input.targetLanguage)) {
    return {
      success: false,
      message: "Target language must be 'same' or a valid language tag such as 'en' or 'fr-FR'.",
    };
  }

  if (
    input.targetLanguage.length > 35 ||
    (input.operation === "translate" && input.targetLanguage === "same")
  ) {
    return {
      success: false,
      message:
        "Choose an explicit target language for translation, using a language tag of at most 35 characters.",
    };
  }

  return {
    success: true,
    value: {
      text: input.text,
      operation: input.operation,
      tone: input.tone,
      targetLanguage: input.targetLanguage,
    },
  };
}

export function isRewriteResponse(input: unknown): input is RewriteResponse {
  if (!isRecord(input)) {
    return false;
  }

  return (
    typeof input.rewrittenText === "string" &&
    input.rewrittenText.trim().length > 0 &&
    input.rewrittenText.length <= MAX_REWRITTEN_CHARACTERS &&
    typeof input.requestId === "string" &&
    input.requestId.length > 0 &&
    typeof input.model === "string" &&
    input.model.length > 0 &&
    (input.detectedLanguage === undefined || typeof input.detectedLanguage === "string")
  );
}

export function isApiErrorResponse(input: unknown): input is ApiErrorResponse {
  if (!isRecord(input) || !isRecord(input.error)) {
    return false;
  }

  return (
    isApiErrorCode(input.error.code) &&
    typeof input.error.message === "string" &&
    typeof input.error.requestId === "string"
  );
}
