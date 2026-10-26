import { describe, expect, it } from "vitest";
import { buildCreativeWhere, parseCreativeFilters, resolveExportFields } from "./filters";

describe("creative filters", () => {
  it("normalizes URL search params into a reusable creative filter model", () => {
    const filters = parseCreativeFilters(new URLSearchParams({
      advertiserId: "adv-1",
      country: "gb",
      status: "ACTIVE",
      format: "VIDEO",
      store: "GOOGLE_PLAY",
      appId: "cheap",
      dateField: "lastShownAt",
      dateFrom: "2026-01-01",
      dateTo: "2026-05-24",
      creativeIds: "CR1, CR2"
    }));

    expect(filters).toMatchObject({
      advertiserId: "adv-1",
      country: "GB",
      status: "ACTIVE",
      format: "VIDEO",
      store: "GOOGLE_PLAY",
      appId: "cheap",
      dateField: "lastShownAt",
      creativeIds: ["CR1", "CR2"]
    });
  });

  it("parses repeated selected creative ids from bulk export URLs", () => {
    const params = new URLSearchParams();
    params.append("creativeIds", "CR1");
    params.append("creativeIds", "CR2, CR3");

    expect(parseCreativeFilters(params).creativeIds).toEqual(["CR1", "CR2", "CR3"]);
  });

  it("caps free-form filters so one request cannot build huge queries", () => {
    const params = new URLSearchParams();
    params.set("q", "x".repeat(500));
    params.set("appId", "app".repeat(100));
    params.set("creativeIds", Array.from({ length: 700 }, (_, index) => `CR${index}`).join(","));

    const filters = parseCreativeFilters(params);

    expect(filters.q).toHaveLength(120);
    expect(filters.appId).toHaveLength(120);
    expect(filters.creativeIds).toHaveLength(500);
  });

  it("supports collection activity filters for new and disappeared creatives", () => {
    const newToday = buildCreativeWhere({ activity: "NEW_TODAY" });
    const disappeared = buildCreativeWhere({ activity: "DISAPPEARED" });

    expect(newToday.firstFoundAt).toBeTruthy();
    expect(disappeared).toMatchObject({ status: "STOPPED" });
  });

  it("ignores malformed date filters instead of creating invalid Prisma dates", () => {
    const filters = parseCreativeFilters(new URLSearchParams({
      dateField: "updatedAt",
      dateFrom: "not-a-date",
      dateTo: "2026-99-99"
    }));

    expect(filters.dateFrom).toBeUndefined();
    expect(filters.dateTo).toBeUndefined();
    expect(buildCreativeWhere(filters)).not.toHaveProperty("updatedAt");
  });

  it("builds a Prisma where object shared by list and export screens", () => {
    const where = buildCreativeWhere({
      advertiserId: "adv-1",
      country: "GB",
      status: "ACTIVE",
      format: "VIDEO",
      store: "GOOGLE_PLAY",
      dateField: "firstShownAt",
      dateFrom: "2026-01-01",
      dateTo: "2026-05-24"
    });

    expect(where).toMatchObject({
      advertiserId: "adv-1",
      status: "ACTIVE",
      format: "VIDEO",
      firstShownAt: {
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lte: new Date("2026-05-24T23:59:59.999Z")
      },
      app: { store: "GOOGLE_PLAY" },
      countries: { some: { countryCode: { in: ["GB"] } } }
    });
  });

  it("supports intelligence filters for coverage and text fields", () => {
    const where = buildCreativeWhere({
      countries: ["GB", "DE"],
      appName: "Collage",
      developer: "Seraleev",
      advertiserName: "Sarafan",
      hasTitle: true,
      hasDescription: true,
      hasGeo: true,
      hasVideo: true,
      hasApp: true,
      hasDetails: true,
      hasPreview: true,
      hasAssets: true,
      minPublicDays: 30,
      updatedSince: "2026-06-01"
    });

    expect(where).toMatchObject({
      publicDays: { gte: 30 },
      appDbId: { not: null },
      detailFetchedAt: { not: null },
      previewUrl: { not: null },
      advertiser: { name: { contains: "Sarafan", mode: "insensitive" } },
      app: {
        name: { contains: "Collage", mode: "insensitive" },
        developer: { contains: "Seraleev", mode: "insensitive" }
      },
      countries: { some: { countryCode: { in: ["GB", "DE"] } } },
      assets: { some: { kind: { in: ["VIDEO"] } } },
      updatedAt: { gte: new Date("2026-06-01T00:00:00.000Z") }
    });
    expect(where).toHaveProperty("AND");
  });

  it("ignores empty filter fields submitted by dashboard forms", () => {
    const where = buildCreativeWhere({
      advertiserId: "",
      country: "",
      q: "CR063"
    });

    expect(where).toMatchObject({
      OR: [
        { creativeId: { contains: "CR063", mode: "insensitive" } },
        { advertiser: { name: { contains: "CR063", mode: "insensitive" } } },
        { advertiser: { googleAdvertiserId: { contains: "CR063", mode: "insensitive" } } },
        { app: { appId: { contains: "CR063", mode: "insensitive" } } },
        { app: { name: { contains: "CR063", mode: "insensitive" } } },
        { app: { developer: { contains: "CR063", mode: "insensitive" } } },
        { title: { contains: "CR063", mode: "insensitive" } },
        { description: { contains: "CR063", mode: "insensitive" } }
      ]
    });
    expect(where).not.toHaveProperty("advertiserId");
    expect(where).not.toHaveProperty("countries");
  });

  it("keeps export fields ordered and limited to known columns", () => {
    expect(resolveExportFields("creativeId,unknown,status,appName")).toEqual(["creativeId", "appName", "status"]);
    expect(resolveExportFields(undefined)).toContain("creativeId");
  });
});
