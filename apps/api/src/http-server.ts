import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type ApiErrorResponse, parseRewriteRequest } from "@smartassistance/contracts";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import type { RewriteService } from "./rewrite-service.js";

const REQUEST_DEADLINE_MS = 18_000;
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}
function readJsonBody(
  request: IncomingMessage,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    function cleanup(): void {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    }
    function onError(error: unknown): void {
      cleanup();
      reject(error);
    }
    function onAbort(): void {
      onError(signal.reason);
      request.resume();
    }
    function onData(chunk: Buffer): void {
      receivedBytes += chunk.length;
      if (receivedBytes > maximumBytes) {
        onError(new AppError("INVALID_REQUEST", "Request body is too large.", 413));
        request.resume();
        return;
      }
      chunks.push(chunk);
    }
    function onEnd(): void {
      cleanup();
      try {
        if (!receivedBytes) throw new Error("Empty body.");
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch {
        reject(new AppError("INVALID_REQUEST", "Request body must contain valid JSON.", 400));
      }
    }
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
function authorize(request: IncomingMessage, config: AppConfig): void {
  if (!config.serviceToken) return;
  const candidate = request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice(7)
    : "";
  if (
    !candidate ||
    !timingSafeEqual(
      createHash("sha256").update(candidate).digest(),
      createHash("sha256").update(config.serviceToken).digest(),
    )
  ) {
    throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
  }
}
function applyCors(request: IncomingMessage, response: ServerResponse, config: AppConfig): void {
  const origin = request.headers.origin;
  if (!origin) return;
  const developmentExtension =
    config.nodeEnv !== "production" &&
    config.allowedOrigins.length === 0 &&
    /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  if (!developmentExtension && !config.allowedOrigins.includes(origin)) {
    throw new AppError("INVALID_REQUEST", "Origin is not allowed.", 403);
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Vary", "Origin");
}
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function createHttpServer(config: AppConfig, rewriteService: RewriteService): Server {
  // This is a process-wide spending guard. It makes no per-user or cross-replica guarantee.
  const rateLimiter = new FixedWindowRateLimiter(config.rateLimitPerMinute);
  let inFlight = 0;
  const server = createServer((request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new AppError("TIMEOUT", "The rewrite request timed out.", 504)),
      REQUEST_DEADLINE_MS,
    );
    const disconnected = () => {
      if (!response.writableEnded)
        controller.abort(new AppError("CANCELLED", "The client disconnected.", 499));
    };
    response.once("close", disconnected);
    request.once("aborted", disconnected);
    let admitted = false;
    void (async () => {
      applyCors(request, response, config);
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, {
          providerConfigured: Boolean(config.openAIKey),
          status: config.openAIKey ? "ok" : "degraded",
        });
        return;
      }
      if (url.pathname !== "/v1/rewrites") throw new AppError("NOT_FOUND", "Route not found.", 404);
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST, OPTIONS");
        throw new AppError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      }
      authorize(request, config);
      if (
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      ) {
        throw new AppError("INVALID_REQUEST", "Content-Type must be application/json.", 415);
      }
      const body = await readJsonBody(request, config.maxBodyBytes, controller.signal);
      const parsed = parseRewriteRequest(body);
      if (!parsed.success) throw new AppError("INVALID_REQUEST", parsed.message, 400);
      if (inFlight >= config.maxConcurrentRewrites) {
        response.setHeader("Retry-After", 1);
        throw new AppError("RATE_LIMITED", "The service is busy. Please try again shortly.", 429);
      }
      const rateLimit = rateLimiter.consume("all-rewrites");
      response.setHeader("X-RateLimit-Remaining", rateLimit.remaining);
      if (!rateLimit.allowed) {
        response.setHeader("Retry-After", rateLimit.retryAfterSeconds);
        throw new AppError(
          "RATE_LIMITED",
          "The service request limit was reached. Please try again shortly.",
          429,
        );
      }
      controller.signal.throwIfAborted();
      inFlight += 1;
      admitted = true;
      const result = await untilAborted(
        rewriteService.execute(parsed.value, requestId, controller.signal),
        controller.signal,
      );
      const { promptVersion, providerRequestId, usage, ...publicResult } = result;
      sendJson(response, 200, publicResult);
      console.info(
        JSON.stringify({
          type: "request_completed",
          requestId,
          status: 200,
          durationMs: Date.now() - startedAt,
          operation: parsed.value.operation,
          textLength: parsed.value.text.length,
          model: result.model,
          promptVersion,
          providerRequestId,
          usage,
        }),
      );
    })()
      .catch((error: unknown) => {
        const failure =
          controller.signal.aborted && controller.signal.reason instanceof AppError
            ? controller.signal.reason
            : error instanceof AppError
              ? error
              : new AppError("PROVIDER_ERROR", "An unexpected error occurred.", 500);
        const body: ApiErrorResponse = {
          error: { code: failure.code, message: failure.message, requestId },
        };
        sendJson(response, failure.statusCode, body);
        console.error(
          JSON.stringify({
            type: "request_failed",
            requestId,
            code: failure.code,
            status: failure.statusCode,
            durationMs: Date.now() - startedAt,
          }),
        );
      })
      .finally(() => {
        if (admitted) inFlight -= 1;
        clearTimeout(timeout);
        response.off("close", disconnected);
        request.off("aborted", disconnected);
      });
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = REQUEST_DEADLINE_MS;
  return server;
}
