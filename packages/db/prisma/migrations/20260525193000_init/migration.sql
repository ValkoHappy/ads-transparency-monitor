-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CreativeFormat" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AppStore" AS ENUM ('GOOGLE_PLAY', 'APP_STORE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('ACTIVE', 'STOPPED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'BLOCKED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('FAST', 'FULL', 'CAUTIOUS');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('LANDSCAPE_IMAGE', 'APP_ICON', 'SCREENSHOT', 'COVER_IMAGE', 'VIDEO', 'LANDING_URL');

-- CreateEnum
CREATE TYPE "RawSnapshotKind" AS ENUM ('SEARCH_CREATIVES', 'CREATIVE_DETAIL', 'PREVIEW_SCRIPT', 'API_EXPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Advertiser" (
    "id" TEXT NOT NULL,
    "googleAdvertiserId" TEXT NOT NULL,
    "name" TEXT,
    "transparencyUrl" TEXT,
    "selectedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastScanAt" TIMESTAMP(3),
    "lastSuccessfulScanAt" TIMESTAMP(3),
    "lastScanStatus" "ScanStatus",
    "totalCreatives" INTEGER NOT NULL DEFAULT 0,
    "activeCreatives" INTEGER NOT NULL DEFAULT 0,
    "dailyScanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scanMode" "ScanMode",
    "requestDelayMs" INTEGER,
    "maxPagesPerRun" INTEGER,
    "maxCreativesPerRun" INTEGER,
    "nextScanAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Advertiser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "store" "AppStore" NOT NULL,
    "storeUrl" TEXT,
    "name" TEXT,
    "developer" TEXT,
    "category" TEXT,
    "description" TEXT,
    "shortDescription" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "appDbId" TEXT,
    "format" "CreativeFormat" NOT NULL DEFAULT 'UNKNOWN',
    "status" "CreativeStatus" NOT NULL DEFAULT 'UNKNOWN',
    "previewUrl" TEXT,
    "firstShownAt" TIMESTAMP(3),
    "lastShownAt" TIMESTAMP(3),
    "publicDays" INTEGER,
    "impressionsMin" INTEGER,
    "impressionsMax" INTEGER,
    "firstFoundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFoundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawList" JSONB,
    "rawDetail" JSONB,
    "rawPreview" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeCountry" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "googleGeoId" INTEGER NOT NULL,
    "countryCode" TEXT,
    "countryName" TEXT,
    "impressionsMin" INTEGER,
    "impressionsMax" INTEGER,
    "firstShownDate" TEXT,
    "lastShownDate" TEXT,
    "raw" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeCountry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "scanMode" "ScanMode" NOT NULL DEFAULT 'CAUTIOUS',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "creativesFound" INTEGER NOT NULL DEFAULT 0,
    "detailsFetched" INTEGER NOT NULL DEFAULT 0,
    "previewsFetched" INTEGER NOT NULL DEFAULT 0,
    "blockedReason" TEXT,
    "requestDelayMs" INTEGER,
    "maxPagesPerRun" INTEGER,
    "maxCreativesPerRun" INTEGER,
    "retryOfJobId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "scanJobId" TEXT,
    "status" "ScanStatus" NOT NULL DEFAULT 'RUNNING',
    "scanMode" "ScanMode" NOT NULL DEFAULT 'CAUTIOUS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "creativesFound" INTEGER NOT NULL DEFAULT 0,
    "newCreatives" INTEGER NOT NULL DEFAULT 0,
    "detailsFetched" INTEGER NOT NULL DEFAULT 0,
    "previewsFetched" INTEGER NOT NULL DEFAULT 0,
    "blockedReason" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL,
    "scanJobId" TEXT,
    "scanId" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawApiSnapshot" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT,
    "kind" "RawSnapshotKind" NOT NULL,
    "url" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawApiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scanMode" "ScanMode" NOT NULL DEFAULT 'CAUTIOUS',
    "dailyScanHour" INTEGER NOT NULL DEFAULT 3,
    "scheduleType" TEXT NOT NULL DEFAULT 'DAILY',
    "dailyScanHours" INTEGER[] DEFAULT ARRAY[3]::INTEGER[],
    "scanIntervalHours" INTEGER,
    "requestDelayMs" INTEGER NOT NULL DEFAULT 1000,
    "maxPagesPerRun" INTEGER,
    "maxCreativesPerRun" INTEGER,
    "exportDefaultFields" TEXT[] DEFAULT ARRAY['creativeId', 'advertiserName', 'appName', 'store', 'format', 'status', 'countries', 'publicDays', 'firstShownAt', 'lastShownAt', 'impressions']::TEXT[],
    "proxyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "proxyUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL,
    "pid" INTEGER,
    "message" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Advertiser_googleAdvertiserId_key" ON "Advertiser"("googleAdvertiserId");

-- CreateIndex
CREATE UNIQUE INDEX "App_store_appId_key" ON "App"("store", "appId");

-- CreateIndex
CREATE UNIQUE INDEX "Creative_creativeId_key" ON "Creative"("creativeId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_creativeId_kind_url_key" ON "CreativeAsset"("creativeId", "kind", "url");

-- CreateIndex
CREATE INDEX "CreativeCountry_countryCode_idx" ON "CreativeCountry"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeCountry_creativeId_googleGeoId_key" ON "CreativeCountry"("creativeId", "googleGeoId");

-- CreateIndex
CREATE INDEX "RawApiSnapshot_kind_idx" ON "RawApiSnapshot"("kind");

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_appDbId_fkey" FOREIGN KEY ("appDbId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeCountry" ADD CONSTRAINT "CreativeCountry_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawApiSnapshot" ADD CONSTRAINT "RawApiSnapshot_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
