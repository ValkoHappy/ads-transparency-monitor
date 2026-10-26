import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedSearchCreative } from "@ad-monitor/core";
import { prisma, queueAdvertiserScan, upsertAdvertiser } from "@ad-monitor/db";
import { runAdvertiserScan } from "../../apps/worker/src/scanner";
import { demoNormalizedCreative } from "../../scripts/seed-demo-data";
import { clearTestDatabase } from "./test-db";

function fakeClient(mode: "success" | "failed" | "blocked", calls: Array<{ geoId?: number }> = []) {
  const listCreative: ParsedSearchCreative = {
    advertiserId: "AR14577439029227159553",
    creativeId: "CR06346342443637538817",
    previewUrl: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1",
    format: "VIDEO",
    firstShownAt: new Date("2025-03-07T00:00:00.000Z"),
    lastShownAt: new Date("2026-05-22T00:00:00.000Z"),
    raw: { fixture: "list" }
  };

  return {
    async searchCreatives(input: { geoId?: number }) {
      calls.push({ geoId: input.geoId });
      if (mode === "failed") throw new Error("network failed");
      if (mode === "blocked") throw new Error("blocked:SearchCreatives:429");
      return { creatives: [listCreative], raw: {}, nextPageToken: undefined };
    },
    async collectCreative() {
      return demoNormalizedCreative();
    }
  };
}

describe("worker lifecycle integration", () => {
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("marks job success and updates counters", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);

    await runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: ["GB"],
      dateRange: { start: "20260516", end: "20260523" },
      requestDelayMs: 0
    }, fakeClient("success") as never);

    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    const updatedAdvertiser = await prisma.advertiser.findUniqueOrThrow({ where: { id: advertiser.id } });
    expect(updatedJob.status).toBe("SUCCESS");
    expect(updatedJob.pagesFetched).toBe(1);
    expect(updatedJob.detailsFetched).toBe(1);
    expect(updatedJob.previewsFetched).toBe(1);
    expect(updatedAdvertiser.totalCreatives).toBe(1);
    expect(updatedAdvertiser.activeCreatives).toBe(1);
  });

  it("scans the advertiser without a geo filter when countries are not selected", async () => {
    const calls: Array<{ geoId?: number }> = [];
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: [] });
    const job = await queueAdvertiserScan(advertiser.id, []);

    await runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: [],
      dateRange: { start: "20250524", end: "20260524" },
      requestDelayMs: 0
    }, fakeClient("success", calls) as never);

    expect(calls).toEqual([{ geoId: undefined }]);
    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("SUCCESS");
    expect(updatedJob.countries).toEqual([]);
  });

  it("collects all search pages before starting detail RPC enrichment", async () => {
    const calls: string[] = [];
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: [] });
    const job = await queueAdvertiserScan(advertiser.id, [], { scanMode: "FULL", refreshDetails: true });
    const makeListCreative = (creativeId: string): ParsedSearchCreative => ({
      advertiserId: advertiser.googleAdvertiserId,
      creativeId,
      previewUrl: `https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=${creativeId}`,
      format: "VIDEO",
      raw: { fixture: "list", creativeId }
    });
    const pages = [
      { creatives: [makeListCreative("CR10000000000000000001")], raw: {}, nextPageToken: "page-2" },
      { creatives: [makeListCreative("CR10000000000000000002")], raw: {}, nextPageToken: undefined }
    ];
    const client = {
      async searchCreatives() {
        const index = calls.filter((call) => call === "search").length;
        calls.push("search");
        return pages[index];
      },
      async collectCreative(input: { creativeId: string; collectDetail?: boolean }) {
        calls.push(`${input.collectDetail === false ? "list" : "detail"}:${input.creativeId}`);
        return {
          ...demoNormalizedCreative(),
          creativeId: input.creativeId,
          raw: input.collectDetail === false
            ? { list: { fixture: "list", creativeId: input.creativeId }, preview: { fixture: "preview" } }
            : { list: { fixture: "list", creativeId: input.creativeId }, detail: { fixture: "detail" }, preview: { fixture: "preview" } }
        };
      }
    };

    await runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: [],
      requestDelayMs: 0,
      scanMode: "FULL",
      refreshDetails: true
    }, client as never);

    expect(calls).toEqual([
      "search",
      "list:CR10000000000000000001",
      "search",
      "list:CR10000000000000000002",
      "detail:CR10000000000000000001",
      "detail:CR10000000000000000002"
    ]);
  });

  it("marks ordinary failures as FAILED and records an event", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);

    await expect(runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: ["GB"],
      dateRange: { start: "20260516", end: "20260523" },
      requestDelayMs: 0
    }, fakeClient("failed") as never)).rejects.toThrow("network failed");

    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("FAILED");
    expect(await prisma.scanEvent.count({ where: { scanJobId: job.id, level: "error" } })).toBe(1);
  });

  it("marks blocked failures as BLOCKED", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);

    await expect(runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: ["GB"],
      dateRange: { start: "20260516", end: "20260523" },
      requestDelayMs: 0
    }, fakeClient("blocked") as never)).rejects.toThrow("blocked:");

    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("BLOCKED");
    expect(updatedJob.blockedReason).toBe("blocked:SearchCreatives:429");
  });
});
