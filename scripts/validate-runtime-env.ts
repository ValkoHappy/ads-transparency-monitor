import { validateWebEnv, validateWorkerEnv } from "@ad-monitor/db";
import { validateMcpEnv } from "../apps/mcp/src/env.js";

const target = process.argv[2];

if (target === "web") {
  validateWebEnv();
} else if (target === "worker") {
  validateWorkerEnv();
} else if (target === "mcp") {
  validateMcpEnv();
} else {
  throw new Error("Usage: tsx scripts/validate-runtime-env.ts web|worker|mcp");
}

console.log(`${target} runtime env ok`);
