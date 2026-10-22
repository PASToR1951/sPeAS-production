import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/admin",
  timeout: 30_000,
  use: { baseURL: process.env.PEAS_BASE_URL || "http://localhost:8000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "reporting-mobile",
      testMatch: /reporting\.spec\.ts/,
      grep: /@reporting/,
      use: { ...devices["Pixel 7"] },
    },
    { name: "upload-webkit", testMatch: /(?:upload-document|documents-catalog)\.spec\.ts/, use: { ...devices["Desktop Safari"] } },
    {
      name: "author-modal-webkit",
      testMatch: /authors-reference-data\.spec\.ts/,
      grep: /author edit modal preserves/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
