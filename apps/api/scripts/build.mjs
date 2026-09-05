import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

await rm(new URL("../dist", import.meta.url), { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  external: ["openai"],
  format: "esm",
  logLevel: "info",
  outfile: fileURLToPath(new URL("../dist/server.js", import.meta.url)),
  platform: "node",
  sourcemap: true,
  target: "node24",
});
