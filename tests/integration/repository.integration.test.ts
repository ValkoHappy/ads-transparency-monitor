import { beforeEach, describe, expect, it } from "vitest";
import { authenticateMcpAccessToken, cancelScanJob, createMcpAccessToken, getSystemSettings, prisma, queueAdvertiserScan, recomputeCreativeStatuses, revokeMcpAccessToken, saveNormalizedCreative, updateSystemSettings, upsertAdvertiser } from "@ad-monitor/db";
import { demoNormalizedCreative, seedDemoData } from "../../scripts/seed-demo-data";
import { clearTestDatabase } from "./test-db";

describe("repository integration", () => {
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("upserts advertiser, queues scans, saves normalized creatives and stays idempotent", async () => {
    const advertiser = await upsertAdvertiser({
      input: "https://adstransparency.google.com/advertiser/AR14577439029227159553?region=GB",
      name: "Demo Advertiser",
      selectedCountries: ["GB", "BE"]
    });

    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);
    expect(job.status).toBe("QUEUED");
    expect(job.maxPagesPerRun).toBe(100);

    await seedDemoData(prisma);
    await seedDemoData(prisma);

    expect(await prisma.advertiser.count()).toBe(1);
    expect(await prisma.app.count()).toBe(1);
    expect(await prisma.creative.count()).toBe(1);
    expect(await prisma.creativeAsset.count()).toBe(1);
    expect(await prisma.creativeCountry.count()).toBe(3);
    expect(await prisma.rawApiSnapshot.count()).toBeGreaterThanOrEqual(3);

    const creative = await prisma.creative.findUniqueOrThrow({
      where: { creativeId: "CR06346342443637538817" },
      include: { advertiser: true, app: true, countries: true }
    });
    expect(creative.advertiser.googleAdvertiserId).toBe("AR14577439029227159553");
    expect(creative.app?.appId).toBe("com.example.demo");
    expect(creative.countries.map((country) => country.countryCode).sort()).toEqual(["DE", "GB", "IT"]);
  });

  it("creates and updates singleton settings in the database", async () => {
    const defaults = await getSystemSettings(prisma);
    expect(defaults.defaultCountries).toEqual([]);
    expect(defaults.scanMode).toBe("FULL");

    const updated = await updateSystemSettings({
      scanMode: "FULL",
      requestDelayMs: 1500,
      exportDefaultFields: ["creativeId", "advertiserName", "status"],
      proxyEnabled: true,
      proxyUrl: "http://proxy.local:8080"
    }, prisma);

    expect(updated.defaultCountries).toEqual([]);
    expect(updated.scanMode).toBe("FULL");
    expect(updated.requestDelayMs).toBe(1500);
    expect(await prisma.systemSettings.count()).toBe(1);
  });

  it("creates, authenticates and revokes MCP access tokens without storing plaintext", async () => {
    const created = await createMcpAccessToken({
      name: "MCP read token",
      accessLevel: "READ"
    }, prisma);

    expect(created.token).toMatch(/^atm_ro_/);
    expect(created.record.tokenPrefix).toBe(created.token.slice(0, 18));
    expect(created.record.tokenHash).not.toBe(created.token);

    const authenticated = await authenticateMcpAccessToken(created.token, prisma);
    expect(authenticated).toMatchObject({
      source: "db",
      tokenId: created.record.id,
      tokenPrefix: created.record.tokenPrefix,
      accessLevel: "READ",
      isAdmin: false
    });

    const refreshed = await prisma.mcpAccessToken.findUniqueOrThrow({ where: { id: created.record.id } });
    expect(refreshed.lastUsedAt).toBeTruthy();

    await revokeMcpAccessToken(created.record.id, prisma);
    expect(await authenticateMcpAccessToken(created.token, prisma)).toBeNull();
  });

  it("queues scan jobs with mode and retry metadata without executing worker code", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const original = await queueAdvertiserScan(advertiser.id, ["GB"], { scanMode: "FULL", maxPagesPerRun: 10 });
    const retry = await queueAdvertiserScan(advertiser.id, ["GB"], { retryOfJobId: original.id, scanMode: "CAUTIOUS" });

    expect(original.status).toBe("QUEUED");
    expect(original.scanMode).toBe("FULL");
    expect(original.maxPagesPerRun).toBe(10);
    expect(retry.retryOfJobId).toBe(original.id);
    expect(await prisma.scan.count()).toBe(0);
  });

  it("updates an existing queued scan instead of returning stale options", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const original = await queueAdvertiserScan(advertiser.id, ["GB"], { scanMode: "FAST", maxPagesPerRun: 1, refreshDetails: false });
    const updated = await queueAdvertiserScan(advertiser.id, [], { scanMode: "FULL", maxPagesPerRun: undefined, refreshDetails: true });

    expect(updated.id).toBe(original.id);
    expect(updated.scanMode).toBe("FULL");
    expect(updated.countries).toEqual([]);
    expect(updated.refreshDetails).toBe(true);
    expect(updated.maxPagesPerRun).toBe(100);
    expect(await prisma.scanJob.count()).toBe(1);
  });

  it("uses full-scan defaults for retry jobs when limits are omitted", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const original = await queueAdvertiserScan(advertiser.id, ["GB"], { scanMode: "FULL", maxPagesPerRun: 100 });
    const retry = await queueAdvertiserScan(advertiser.id, ["GB"], { retryOfJobId: original.id, scanMode: "FULL" });

    expect(retry.maxPagesPerRun).toBe(100);
    expect(retry.maxCreativesPerRun).toBeNull();
  });

  it("keeps concurrent queue requests to one active scan per advertiser", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const jobs = await Promise.all(Array.from({ length: 8 }, (_, index) => queueAdvertiserScan(advertiser.id, index % 2 ? ["GB"] : [], {
      scanMode: index % 2 ? "FAST" : "FULL",
      refreshDetails: index % 2 === 0
    })));

    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
    expect(await prisma.scanJob.count({ where: { advertiserId: advertiser.id, status: { in: ["QUEUED", "RUNNING"] } } })).toBe(1);
  });

  it("does not mark a claimed running scan as canceled when cancel races with the worker", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553" });
    const queued = await queueAdvertiserScan(advertiser.id, []);
    await prisma.scanJob.update({ where: { id: queued.id }, data: { status: "RUNNING", startedAt: new Date() } });

    const canceled = await cancelScanJob(queued.id, prisma);

    expect(canceled?.status).toBe("RUNNING");
    expect(canceled?.cancelRequested).toBe(true);
    expect(canceled?.finishedAt).toBeNull();
  });

  it("does not erase detail data during list-only saves and replaces countries on fresh detail", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553" });
    const full = demoNormalizedCreative();
    await saveNormalizedCreative(advertiser.id, full, prisma);

    const listOnly = {
      ...full,
      app: undefined,
      countries: [],
      totalStats: undefined,
      assets: [],
      raw: { list: { fixture: "list-refresh" } }
    };
    await saveNormalizedCreative(advertiser.id, listOnly, prisma);

    const afterListOnly = await prisma.creative.findUniqueOrThrow({
      where: { creativeId: full.creativeId },
      include: { countries: true }
    });
    expect(afterListOnly.rawDetail).toEqual({ fixture: "detail" });
    expect(afterListOnly.detailFetchedAt).toBeTruthy();
    expect(afterListOnly.appDbId).toBeTruthy();
    expect(afterListOnly.countries.map((country) => country.countryCode).sort()).toEqual(["DE", "GB", "IT"]);

    await saveNormalizedCreative(advertiser.id, {
      ...full,
      countries: [full.countries[0]],
      raw: { ...full.raw, detail: { fixture: "detail-refresh" } }
    }, prisma);

    const afterDetailRefresh = await prisma.creative.findUniqueOrThrow({
      where: { creativeId: full.creativeId },
      include: { countries: true }
    });
    expect(afterDetailRefresh.rawDetail).toEqual({ fixture: "detail-refresh" });
    expect(afterDetailRefresh.countries.map((country) => country.countryCode)).toEqual(["IT"]);
  });

  it("recomputes stale creative statuses and refreshes advertiser counters", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553" });
    const now = new Date("2026-06-26T12:00:00.000Z");

    await prisma.creative.createMany({
      data: [
        {
          creativeId: "CR_STATUS_OLD",
          advertiserId: advertiser.id,
          format: "IMAGE",
          status: "ACTIVE",
          lastShownAt: new Date("2026-05-01T00:00:00.000Z"),
          lastFoundAt: now
        },
        {
          creativeId: "CR_STATUS_FRESH",
          advertiserId: advertiser.id,
          format: "IMAGE",
          status: "STOPPED",
          lastShownAt: new Date("2026-06-24T00:00:00.000Z"),
          lastFoundAt: now
        },
        {
          creativeId: "CR_STATUS_UNKNOWN",
          advertiserId: advertiser.id,
          format: "IMAGE",
          status: "ACTIVE",
          lastShownAt: null,
          lastFoundAt: now
        }
      ]
    });

    const result = await recomputeCreativeStatuses({ advertiserId: advertiser.id, now }, prisma);

    expect(result).toMatchObject({
      advertiserId: advertiser.id,
      total: 3,
      active: 3,
      stopped: 0,
      unknown: 0
    });

    const creatives = await prisma.creative.findMany({
      where: { advertiserId: advertiser.id },
      orderBy: { creativeId: "asc" },
      select: { creativeId: true, status: true }
    });
    expect(creatives).toEqual([
      { creativeId: "CR_STATUS_FRESH", status: "ACTIVE" },
      { creativeId: "CR_STATUS_OLD", status: "ACTIVE" },
      { creativeId: "CR_STATUS_UNKNOWN", status: "ACTIVE" }
    ]);

    const refreshedAdvertiser = await prisma.advertiser.findUniqueOrThrow({
      where: { id: advertiser.id },
      select: { activeCreatives: true, totalCreatives: true }
    });
    expect(refreshedAdvertiser).toMatchObject({
      totalCreatives: 3,
      activeCreatives: 3
    });
  });
});
