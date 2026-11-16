import { defineConfig } from "@playwright/test";
import { frontend } from "./constants.js";
export default defineConfig({
  testDir: ".", testMatch: "**/*.spec.ts", workers: 1, retries: 0, timeout: 30_000,
  use: { baseURL: frontend, browserName: "chromium", viewport: { width: 1440, height: 1000 } },
  outputDir: "../../.agentbrake-local/product-ui-results", reporter: "list",
});
