import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: "./tests/imports",
  timeout: 90000,
  workers: 1,
  fullyParallel: false,
  use: {
    storageState: process.env.IMPORT_TEST_ARTIFACTS
      ? path.join(process.env.IMPORT_TEST_ARTIFACTS, "admin-auth.json")
      : undefined,
    baseURL: process.env.PEAS_BASE_URL || "http://127.0.0.1:8000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
