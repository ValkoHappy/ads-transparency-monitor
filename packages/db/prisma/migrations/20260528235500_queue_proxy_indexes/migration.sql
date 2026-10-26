CREATE INDEX "Advertiser_dailyScanEnabled_nextScanAt_idx" ON "Advertiser"("dailyScanEnabled", "nextScanAt");
CREATE INDEX "Scan_scanJobId_startedAt_idx" ON "Scan"("scanJobId", "startedAt");
CREATE INDEX "Scan_advertiserId_startedAt_idx" ON "Scan"("advertiserId", "startedAt");
CREATE INDEX "ProxyEndpoint_status_blockedUntil_lastUsedAt_idx" ON "ProxyEndpoint"("status", "blockedUntil", "lastUsedAt");
