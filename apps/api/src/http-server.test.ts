import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "./config.js";
import { createHttpServer } from "./http-server.js";
import { RewriteService, type RewriteProvider } from "./rewrite-service.js";
const request = {
  operation: "improve",
  tone: "natural",
  targetLanguage: "same",
  text: "synthetic private draft",
};
const servers: Server[] = [];
async function start(
  provider: RewriteProvider = {
    rewrite: async () => ({ rewrittenText: "Synthetic result", model: "fake" }),
  },
  overrides: Partial<AppConfig> = {},
) {
  const server = createHttpServer(
    { ...loadConfig({ NODE_ENV: "test" }), ...overrides },
    new RewriteService(provider),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/rewrites`;
}
function post(url: string, body: unknown = request, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
});
describe("HTTP trust boundary", () => {
  it("returns a rewrite while logging metadata without text", async () => {
    const url = await start({
      rewrite: async () => ({
        rewrittenText: "Synthetic result",
        model: "fake",
        promptVersion: "v1",
        providerRequestId: "p1",
        usage: { inputTokens: 3, outputTokens: 4 },
      }),
    });
    const response = await post(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      rewrittenText: "Synthetic result",
      model: "fake",
    });
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain("inputTokens");
    expect(logs).not.toContain(request.text);
    expect(logs).not.toContain("Synthetic result");
  });
  it("rejects missing credentials before provider execution", async () => {
    const rewrite = vi.fn();
    const url = await start({ rewrite }, { serviceToken: "synthetic-secret" });
    expect((await post(url)).status).toBe(401);
    expect(rewrite).not.toHaveBeenCalled();
  });
  it("permits the configured token", async () => {
    const url = await start(undefined, { serviceToken: "synthetic-secret" });
    expect((await post(url, request, { Authorization: "Bearer synthetic-secret" })).status).toBe(
      200,
    );
  });
  it("rejects disallowed origins rather than only omitting CORS headers", async () => {
    const rewrite = vi.fn();
    const url = await start({ rewrite });
    expect((await post(url, request, { Origin: "https://untrusted.example" })).status).toBe(403);
    expect(rewrite).not.toHaveBeenCalled();
  });
  it("allows extension origins in local development", async () => {
    const url = await start();
    const origin = `chrome-extension://${"a".repeat(32)}`;
    const response = await post(url, request, { Origin: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  });
  it("validates media type, JSON, schema, and maximum bytes", async () => {
    const url = await start(undefined, { maxBodyBytes: 1024 });
    expect((await post(url, request, { "Content-Type": "text/plain" })).status).toBe(415);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        })
      ).status,
    ).toBe(400);
    expect((await post(url, { ...request, pageContent: "not allowed" })).status).toBe(400);
    expect((await post(url, { ...request, text: "a".repeat(2000) })).status).toBe(413);
  });
  it("applies a process-wide request budget", async () => {
    const url = await start(undefined, { rateLimitPerMinute: 1 });
    expect((await post(url)).status).toBe(200);
    const response = await post(url);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
  });
  it("bounds concurrent provider calls", async () => {
    let finish: (() => void) | undefined;
    const rewrite = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { rewrittenText: "done", model: "fake" };
    });
    const url = await start({ rewrite }, { maxConcurrentRewrites: 1 });
    const first = post(url);
    await vi.waitFor(() => expect(rewrite).toHaveBeenCalledOnce());
    expect((await post(url)).status).toBe(429);
    finish?.();
    expect((await first).status).toBe(200);
  });
  it("propagates client disconnect to the provider", async () => {
    let providerSignal: AbortSignal | undefined;
    const rewrite = vi.fn(async (_request, signal?: AbortSignal) => {
      providerSignal = signal;
      await new Promise<void>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
      return { rewrittenText: "unreachable", model: "fake" };
    });
    const url = await start({ rewrite });
    const controller = new AbortController();
    const pending = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    }).catch(() => undefined);
    await vi.waitFor(() => expect(rewrite).toHaveBeenCalledOnce());
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true));
  });
});
