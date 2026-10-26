import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? 3101);
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm --workspace apps/web run start -- --hostname 127.0.0.1 --port ${e2ePort}`,
    url: `${e2eBaseUrl}/login`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://ads:ads@localhost:55433/ads_monitor_verify?schema=public",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "test-secret",
      ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "admin@ads-monitor.local",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "TestOnly!ChangeInCi2026",
      ALLOW_INSECURE_TEST_SECRETS: "true"
    }
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
});
