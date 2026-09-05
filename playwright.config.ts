import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  use: { headless: true },
});
