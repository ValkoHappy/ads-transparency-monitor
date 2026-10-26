import { describe, expect, it } from "vitest";
import type { NormalizedCreative } from "@ad-monitor/core";
import { buildCreativePersistenceModel, parseAdvertiserInput } from "./mappers";

describe("database mappers", () => {
  it("parses advertiser ids from Transparency URLs and raw ids", () => {
    expect(parseAdvertiserInput("AR14577439029227159553")).toEqual({
      googleAdvertiserId: "AR14577439029227159553",
      transparencyUrl: "https://adstransparency.google.com/advertiser/AR14577439029227159553"
    });

    expect(parseAdvertiserInput("https://adstransparency.google.com/advertiser/AR14577439029227159553?region=GB")).toEqual({
      googleAdvertiserId: "AR14577439029227159553",
      transparencyUrl: "https://adstransparency.google.com/advertiser/AR14577439029227159553"
    });
  });

  it("builds a persistence model without losing raw snapshots", () => {
    const normalized: NormalizedCreative = {
      advertiserId: "AR14577439029227159553",
      advertiserName: "Karen Manukyan",
      creativeId: "CR06346342443637538817",
      title: "Cheap Flights",
      description: "Meilleurs prix pour les vols",
      format: "VIDEO",
      status: "ACTIVE",
      previewUrls: ["https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1"],
      firstShownAt: new Date("2025-03-07T00:00:00.000Z"),
      lastShownAt: new Date("2026-05-22T00:00:00.000Z"),
      publicDays: 441,
      app: {
        appId: "com.flightsbooking.tickets.app",
        appName: "Cheap Flights",
        store: "GOOGLE_PLAY",
        storeUrl: "https://play.google.com/store/apps/details?id=com.flightsbooking.tickets.app",
        developer: "Cheap Flights Tickets App",
        category: "TRAVEL_AND_LOCAL",
        description: "Meilleurs prix pour les vols"
      },
      countries: [
        {
          googleGeoId: 2826,
          countryCode: "GB",
          countryName: "United Kingdom",
          lastShownDate: "2026-05-22",
          raw: { "1": 2826 }
        }
      ],
      totalStats: {
        impressionsMin: 60000,
        impressionsMax: 70000,
        firstShownDate: "2025-03-07",
        lastShownDate: "2026-05-22",
        raw: { "2": "60000" }
      },
      assets: [
        { kind: "LANDSCAPE_IMAGE", url: "https://tpc.googlesyndication.com/simgad/1" }
      ],
      raw: {
        list: { list: true },
        detail: { detail: true },
        preview: { appId: "com.flightsbooking.tickets.app" }
      }
    };

    const model = buildCreativePersistenceModel(normalized);

    expect(model.creative.creativeId).toBe("CR06346342443637538817");
    expect(model.creative.title).toBe("Cheap Flights");
    expect(model.creative.description).toBe("Meilleurs prix pour les vols");
    expect(model.app?.where).toEqual({ store_appId: { store: "GOOGLE_PLAY", appId: "com.flightsbooking.tickets.app" } });
    expect(model.assets).toHaveLength(1);
    expect(model.countries[0]).toMatchObject({ googleGeoId: 2826, countryCode: "GB" });
    expect(model.rawSnapshots.map((snapshot) => snapshot.kind)).toEqual([
      "SEARCH_CREATIVES",
      "CREATIVE_DETAIL",
      "PREVIEW_SCRIPT"
    ]);
  });
});
