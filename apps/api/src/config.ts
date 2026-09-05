export interface AppConfig {
  allowedOrigins: readonly string[];
  host: string;
  maxBodyBytes: number;
  maxOutputTokens: number;
  maxConcurrentRewrites: number;
  model: string;
  nodeEnv: "development" | "production" | "test";
  openAIKey?: string;
  port: number;
  providerTimeoutMs: number;
  rateLimitPerMinute: number;
  serviceToken?: string;
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  limits: { minimum: number; maximum: number },
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < limits.minimum || parsed > limits.maximum) {
    throw new Error(`${name} must be an integer from ${limits.minimum} to ${limits.maximum}.`);
  }

  return parsed;
}

function readNodeEnvironment(value: string | undefined): AppConfig["nodeEnv"] {
  if (value === undefined || value === "development") {
    return "development";
  }

  if (value === "production" || value === "test") {
    return value;
  }

  throw new Error("NODE_ENV must be development, production, or test.");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = readNodeEnvironment(env.NODE_ENV);
  const openAIKey = env.OPENAI_API_KEY?.trim();
  const serviceToken = env.SMARTASSISTANCE_API_TOKEN?.trim();
  const configuredOrigins = env.SMARTASSISTANCE_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins?.length ? configuredOrigins : [];

  if (nodeEnv === "production" && !openAIKey) {
    throw new Error("OPENAI_API_KEY is required in production.");
  }

  if (nodeEnv === "production" && !serviceToken) {
    throw new Error(
      "SMARTASSISTANCE_API_TOKEN is required in production until OAuth is implemented.",
    );
  }

  if (allowedOrigins.includes("*") || (nodeEnv === "production" && allowedOrigins.length === 0)) {
    throw new Error("SMARTASSISTANCE_ALLOWED_ORIGINS is required in production.");
  }

  return {
    allowedOrigins,
    host: env.HOST?.trim() || "127.0.0.1",
    maxBodyBytes: readInteger(env, "MAX_BODY_BYTES", 65_536, {
      minimum: 1_024,
      maximum: 1_048_576,
    }),
    maxOutputTokens: readInteger(env, "OPENAI_MAX_OUTPUT_TOKENS", 8192, {
      minimum: 128,
      maximum: 16384,
    }),
    maxConcurrentRewrites: readInteger(env, "MAX_CONCURRENT_REWRITES", 4, {
      minimum: 1,
      maximum: 100,
    }),
    model: env.OPENAI_MODEL?.trim() || "gpt-5.6-luna",
    nodeEnv,
    port: readInteger(env, "PORT", 8_787, { minimum: 1, maximum: 65_535 }),
    providerTimeoutMs: readInteger(env, "OPENAI_TIMEOUT_MS", 15_000, {
      minimum: 1_000,
      maximum: 15_000,
    }),
    rateLimitPerMinute: readInteger(env, "RATE_LIMIT_PER_MINUTE", 20, {
      minimum: 1,
      maximum: 1_000,
    }),
    ...(openAIKey ? { openAIKey } : {}),
    ...(serviceToken ? { serviceToken } : {}),
  };
}
