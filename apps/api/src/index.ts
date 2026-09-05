import { loadConfig } from "./config.js";
import { createHttpServer } from "./http-server.js";
import { OpenAIRewriteProvider, UnavailableRewriteProvider } from "./openai-rewrite-provider.js";
import { RewriteService } from "./rewrite-service.js";

const config = loadConfig();
const provider = config.openAIKey
  ? new OpenAIRewriteProvider({
      apiKey: config.openAIKey,
      model: config.model,
      timeoutMs: config.providerTimeoutMs,
      maxOutputTokens: config.maxOutputTokens,
    })
  : new UnavailableRewriteProvider();
const server = createHttpServer(config, new RewriteService(provider));

server.listen(config.port, config.host, () => {
  console.info(
    JSON.stringify({
      host: config.host,
      model: config.model,
      port: config.port,
      providerConfigured: Boolean(config.openAIKey),
      type: "server_started",
    }),
  );
});

function shutdown(signal: NodeJS.Signals): void {
  console.info(JSON.stringify({ signal, type: "server_stopping" }));
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ type: "server_stop_failed" }));
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
