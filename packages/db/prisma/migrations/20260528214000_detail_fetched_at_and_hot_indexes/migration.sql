ALTER TABLE "Creative" ADD COLUMN "detailFetchedAt" TIMESTAMP(3);

UPDATE "Creative"
SET "detailFetchedAt" = "updatedAt"
WHERE "rawDetail" IS NOT NULL AND "detailFetchedAt" IS NULL;

CREATE INDEX "Creative_advertiserId_updatedAt_idx" ON "Creative"("advertiserId", "updatedAt");
CREATE INDEX "Creative_advertiserId_lastFoundAt_idx" ON "Creative"("advertiserId", "lastFoundAt");
CREATE INDEX "ScanJob_status_createdAt_idx" ON "ScanJob"("status", "createdAt");
CREATE INDEX "ScanJob_advertiserId_status_createdAt_idx" ON "ScanJob"("advertiserId", "status", "createdAt");
CREATE INDEX "ScanEvent_scanJobId_createdAt_idx" ON "ScanEvent"("scanJobId", "createdAt");
CREATE INDEX "ScanEvent_scanId_createdAt_idx" ON "ScanEvent"("scanId", "createdAt");
CREATE INDEX "RawApiSnapshot_createdAt_idx" ON "RawApiSnapshot"("createdAt");
