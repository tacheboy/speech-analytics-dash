import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: "postgres://insights:insights@localhost:5433/insights_test", DEMO_API_KEY: "test_key" },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
