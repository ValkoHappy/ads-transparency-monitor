import type { NormalizedCreative } from "@ad-monitor/core";
import { refreshAdvertiserCounters, saveNormalizedCreative, upsertAdvertiser, type prisma as PrismaClientLike } from "@ad-monitor/db";

type DbClient = typeof PrismaClientLike;

export function demoNormalizedCreative(): NormalizedCreative {
  return {
    advertiserId: "AR14577439029227159553",
    advertiserName: "Demo Advertiser",
    creativeId: "CR06346342443637538817",
    format: "VIDEO",
    status: "ACTIVE",
    previewUrls: ["https://example.com/demo/preview.js"],
    firstShownAt: new Date("2025-03-07T00:00:00.000Z"),
    lastShownAt: new Date("2026-05-22T00:00:00.000Z"),
    publicDays: 441,
    app: {
      appId: "com.example.demo",
      appName: "Demo Travel",
      store: "GOOGLE_PLAY",
      storeUrl: "https://play.google.com/store/apps/details?id=com.example.demo",
      developer: "Example Studio",
      category: "TRAVEL_AND_LOCAL",
      description: "Synthetic application for local tests",
      shortDescription: "Demo travel application"
    },
    countries: [
      {
        googleGeoId: 2380,
        countryCode: "IT",
        countryName: "Italy",
        impressionsMin: 25000,
        impressionsMax: 30000,
        firstShownDate: "2025-03-07",
        lastShownDate: "2026-05-22",
        raw: { "1": 2380, "2": "25000", "3": "30000" }
      },
      {
        googleGeoId: 2276,
        countryCode: "DE",
        countryName: "Germany",
        impressionsMin: 15000,
        impressionsMax: 20000,
        firstShownDate: "2025-03-07",
        lastShownDate: "2026-05-22",
        raw: { "1": 2276, "2": "15000", "3": "20000" }
      },
      {
        googleGeoId: 2826,
        countryCode: "GB",
        countryName: "United Kingdom",
        lastShownDate: "2026-05-22",
        raw: { "1": 2826, "5": 20260522 }
      }
    ],
    totalStats: {
      impressionsMin: 60000,
      impressionsMax: 70000,
      firstShownDate: "2025-03-07",
      lastShownDate: "2026-05-22",
      raw: { "2": "60000", "3": "70000" }
    },
    assets: [
      {
        kind: "LANDSCAPE_IMAGE",
        url: "https://example.com/demo/creative.png"
      }
    ],
    raw: {
      list: { fixture: "search" },
      detail: { fixture: "detail" },
      preview: { appId: "com.example.demo", fixture: "preview" }
    }
  };
}

export async function seedDemoData(db: DbClient) {
  const advertiser = await upsertAdvertiser({
    input: "AR14577439029227159553",
    name: "Demo Advertiser",
    selectedCountries: ["GB", "BE", "FR", "DE", "IT"]
  }, db);

  await saveNormalizedCreative(advertiser.id, demoNormalizedCreative(), db);

  await db.scanJob.upsert({
    where: { id: "seed-scan-job" },
    create: {
      id: "seed-scan-job",
      advertiserId: advertiser.id,
      status: "SUCCESS",
      countries: ["GB", "BE"],
      finishedAt: new Date("2026-05-23T04:58:36.000Z")
    },
    update: {
      advertiserId: advertiser.id,
      status: "SUCCESS",
      countries: ["GB", "BE"],
      finishedAt: new Date("2026-05-23T04:58:36.000Z")
    }
  });

  await db.scanEvent.upsert({
    where: { id: "seed-scan-event" },
    create: {
      id: "seed-scan-event",
      scanJobId: "seed-scan-job",
      level: "info",
      message: "Seed scan completed",
      data: { fixture: true }
    },
    update: {
      scanJobId: "seed-scan-job",
      level: "info",
      message: "Seed scan completed",
      data: { fixture: true }
    }
  });

  await refreshAdvertiserCounters(advertiser.id, db);

  return advertiser;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  process.env.DATABASE_URL ??= "postgresql://ads:ads@localhost:5433/ads_monitor_test?schema=public";
  const { prisma } = await import("@ad-monitor/db");
  await seedDemoData(prisma);
  await prisma.$disconnect();
}
