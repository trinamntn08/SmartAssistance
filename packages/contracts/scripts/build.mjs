import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = new URL("../", import.meta.url);
await rm(new URL("dist", directory), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url)),
    "-p",
    "tsconfig.build.json",
  ],
  { cwd: fileURLToPath(directory), stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
