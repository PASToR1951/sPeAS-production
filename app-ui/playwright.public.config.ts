import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/public",
  timeout: 30_000,
  use: { baseURL: process.env.PEAS_BASE_URL || "http://localhost:8000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
  ],
});
