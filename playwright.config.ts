import { defineConfig } from "@playwright/test";

const TEST_DB = "postgres://insights:insights@localhost:5433/insights_test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3200", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "npx next start --port 3200",
    url: "http://localhost:3200/login",
    reuseExistingServer: false,
    env: { DATABASE_URL: TEST_DB, DEMO_API_KEY: "test_key" },
  },
});
