CREATE TYPE "GoogleHealthStatus" AS ENUM ('OK', 'BLOCKED', 'PROBING', 'DEGRADED');
CREATE TYPE "ProxyStatus" AS ENUM ('OK', 'BLOCKED', 'FAILED');

ALTER TABLE "ScanJob"
  ADD COLUMN "nextPageToken" TEXT,
  ADD COLUMN "currentCountryCode" TEXT,
  ADD COLUMN "chunkStartedAt" TIMESTAMP(3),
  ADD COLUMN "completedCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "SystemSettings"
  ADD COLUMN "advertiserDelayMs" INTEGER NOT NULL DEFAULT 60000,
  ADD COLUMN "probeIntervalMs" INTEGER NOT NULL DEFAULT 3600000;

CREATE TABLE "GoogleHealth" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "status" "GoogleHealthStatus" NOT NULL DEFAULT 'OK',
  "blockedUntil" TIMESTAMP(3),
  "lastProbeAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "consecutiveBlocks" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleHealth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProxyEndpoint" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "status" "ProxyStatus" NOT NULL DEFAULT 'OK',
  "lastUsedAt" TIMESTAMP(3),
  "blockedUntil" TIMESTAMP(3),
  "failCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProxyEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProxyEndpoint_url_key" ON "ProxyEndpoint"("url");
INSERT INTO "GoogleHealth" ("id", "status", "updatedAt") VALUES ('default', 'OK', CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
