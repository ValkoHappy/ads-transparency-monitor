ALTER TABLE "ScanJob" ALTER COLUMN "scanMode" SET DEFAULT 'FULL';
ALTER TABLE "Scan" ALTER COLUMN "scanMode" SET DEFAULT 'FULL';
ALTER TABLE "SystemSettings" ALTER COLUMN "scanMode" SET DEFAULT 'FULL';

UPDATE "SystemSettings"
SET "scanMode" = 'FULL', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default' AND "scanMode" = 'CAUTIOUS';
