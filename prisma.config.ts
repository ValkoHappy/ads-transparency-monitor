import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "packages/db/prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://ads:ads@localhost:5432/ads_monitor?schema=public"
  }
});
