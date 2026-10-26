import { execFileSync } from "node:child_process";
import { join } from "node:path";

process.env.DATABASE_URL ??= "postgresql://ads:ads@localhost:55433/ads_monitor_verify?schema=public";

const target = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/ads_monitor_verify") {
  throw new Error("Refusing to reset a database outside the local ads_monitor_verify test database.");
}

execFileSync(process.execPath, [
  join("node_modules", "prisma", "build", "index.js"),
  "db",
  "push",
  "--force-reset",
  "--accept-data-loss",
  "--schema",
  "packages/db/prisma/schema.prisma"
], {
  stdio: "inherit",
  env: process.env
});
