import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build, context } from "esbuild";

const applicationDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const distributionDirectory = join(applicationDirectory, "dist");
const apiBaseUrl = (process.env.SMARTASSISTANCE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const apiUrl = new URL(apiBaseUrl);

if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
  throw new Error("SMARTASSISTANCE_API_BASE_URL must use http or https.");
}

if (apiUrl.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(apiUrl.hostname)) {
  throw new Error("SMARTASSISTANCE_API_BASE_URL must use https outside loopback development.");
}
if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
  throw new Error(
    "SMARTASSISTANCE_API_BASE_URL must not contain credentials, a query, or a fragment.",
  );
}

async function copyStaticFiles() {
  await mkdir(distributionDirectory, { recursive: true });

  const manifest = JSON.parse(await readFile(join(applicationDirectory, "manifest.json"), "utf8"));
  manifest.host_permissions = [`${apiUrl.origin}/*`];

  await Promise.all([
    writeFile(
      join(distributionDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
    copyFile(
      join(applicationDirectory, "src", "sidepanel.html"),
      join(distributionDirectory, "sidepanel.html"),
    ),
  ]);
}

await rm(distributionDirectory, { force: true, recursive: true });

const options = {
  bundle: true,
  define: {
    __SMARTASSISTANCE_API_BASE_URL__: JSON.stringify(apiBaseUrl),
  },
  entryNames: "[name]",
  entryPoints: {
    "content-script": join(applicationDirectory, "src", "content-script.ts"),
    "service-worker": join(applicationDirectory, "src", "service-worker.ts"),
    sidepanel: join(applicationDirectory, "src", "sidepanel.ts"),
  },
  format: "iife",
  logLevel: "info",
  outdir: distributionDirectory,
  platform: "browser",
  plugins: [
    {
      name: "copy-extension-static-files",
      setup(builder) {
        builder.onEnd(async (result) => {
          if (result.errors.length === 0) {
            await copyStaticFiles();
          }
        });
      },
    },
  ],
  sourcemap: true,
  target: "chrome116",
};

if (process.argv.includes("--watch")) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.info(`Watching extension sources. Load unpacked from ${distributionDirectory}`);
} else {
  await build(options);
}
