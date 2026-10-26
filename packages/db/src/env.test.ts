import { describe, expect, it } from "vitest";
import { validateWebEnv } from "./env";

const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://ads:secret@localhost:5432/ads_monitor",
  AUTH_SECRET: "a".repeat(64),
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "VeryLongAdminPassword2026!"
};

describe("runtime env validation", () => {
  it("requires explicit production cookie security mode", () => {
    expect(() => validateWebEnv(productionEnv as NodeJS.ProcessEnv)).toThrow("AUTH_COOKIE_SECURE");
    expect(validateWebEnv({ ...productionEnv, AUTH_COOKIE_SECURE: "false" } as NodeJS.ProcessEnv).databaseUrl).toContain("postgresql://");
    expect(validateWebEnv({ ...productionEnv, AUTH_COOKIE_SECURE: "true" } as NodeJS.ProcessEnv).databaseUrl).toContain("postgresql://");
  });

  it("rejects known weak production secrets", () => {
    expect(() => validateWebEnv({
      ...productionEnv,
      AUTH_COOKIE_SECURE: "true",
      AUTH_SECRET: "generate-a-64-char-random-secret"
    } as NodeJS.ProcessEnv)).toThrow("Production secrets");
  });
});
