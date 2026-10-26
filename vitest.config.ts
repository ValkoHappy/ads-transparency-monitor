import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@ad-monitor/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@ad-monitor/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.integration.test.ts"],
    fileParallelism: false,
    globals: true
  }
});
