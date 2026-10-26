import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractRpcCalls,
  getGeoTarget,
  normalizeCreative,
  resolveCreativeStatus,
  parseCreativeDetails,
  parsePreviewContentJs,
  parseSearchCreatives
} from "./index";

afterEach(() => {
  vi.useRealTimers();
});

const searchResponse = {
  "1": [
    {
      "1": "AR14577439029227159553",
      "2": "CR12617397735528595457",
      "3": {
        "1": {
          "4": "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=721363400389&sig=abc"
        }
      },
      "4": 3,
      "6": { "1": "1695367088", "2": 400394000 },
      "7": { "1": "1779501516", "2": 567209000 },
      "12": "Karen Manukyan",
      "13": 500
    }
  ],
  "2": "NEXT_PAGE_TOKEN",
  "4": 600,
  "5": 700
};

const detailResponse = {
  "1": {
    "1": "AR14577439029227159553",
    "2": "CR06346342443637538817",
    "4": { "1": "1779495161", "2": 711002000 },
    "5": [
      {
        "1": {
          "4": "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=737259876424&sig=one"
        }
      },
      {
        "1": {
          "4": "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=737259876424&sig=two"
        }
      }
    ],
    "8": 3,
    "17": [
      { "1": 2056, "3": "1000", "4": 20250307, "5": 20260428, "8": [{ "1": 5, "3": "1000" }] },
      { "1": 2250, "2": "10000", "3": "15000", "4": 20250307, "5": 20260522, "8": [{ "1": 3, "2": "9000", "3": "10000" }, { "1": 5, "2": "1000", "3": "2000" }] },
      { "1": 2826, "5": 20260522 }
    ],
    "19": {
      "2": "60000",
      "3": "70000",
      "4": 20250307,
      "5": 20260522,
      "8": [{ "1": 3, "2": "50000", "3": "60000" }, { "1": 5, "2": "10000", "3": "15000" }]
    }
  }
};

const previewScript = String.raw`
  (function(){
    var ad = {google_template_data: {'adData': [{
      'description1': 'Meilleurs prix pour les vols',
      'appStore': '2',
      'appId': 'com.flightsbooking.tickets.app',
      'landscapeImage': 'https://tpc.googlesyndication.com/simgad/7117847437982836729',
      'appName': 'Billets et billets pas chers',
      'developer': 'Cheap Flights Tickets App',
      'appStoreName': 'Google Play',
      'appCategory': 'TRAVEL_AND_LOCAL',
      'shortDescription': 'Recherchez des vols pas chers',
      'destination_url': 'https://play.google.com/store/apps/details?id\x3dcom.flightsbooking.tickets.app',
      'appIconHighRes': '//lh3.googleusercontent.com/icon',
      'screenshot1': '//lh3.googleusercontent.com/screen1',
      'coverImage': '//lh3.googleusercontent.com/cover'
    }]}};
  })();
`;

describe("Google Ads Transparency parser", () => {
  it("parses SearchCreatives list items and pagination", () => {
    const parsed = parseSearchCreatives(searchResponse);

    expect(parsed.nextPageToken).toBe("NEXT_PAGE_TOKEN");
    expect(parsed.creatives).toHaveLength(1);
    expect(parsed.creatives[0]).toMatchObject({
      advertiserId: "AR14577439029227159553",
      creativeId: "CR12617397735528595457",
      format: "VIDEO",
      advertiserName: "Karen Manukyan",
      previewUrl: expect.stringContaining("creativeId=721363400389")
    });
    expect(parsed.creatives[0].firstShownAt?.toISOString()).toBe("2023-09-22T07:18:08.000Z");
    expect(parsed.creatives[0].lastShownAt?.toISOString()).toBe("2026-05-23T01:58:36.000Z");
    expect(parsed.creatives[0].assets).toEqual([]);
  });

  it("parses inline image-only SearchCreatives cards", () => {
    const parsed = parseSearchCreatives({
      "1": [{
        "1": "AR16367185333495791617",
        "2": "CR02768838851634921473",
        "3": {
          "3": {
            "2": "<img src=\"https://tpc.googlesyndication.com/archive/simgad/10687578746076906992\" height=\"199\" width=\"380\">"
          },
          "5": true
        },
        "4": 1,
        "6": { "1": "1728712191", "2": 484433000 },
        "7": { "1": "1748485238", "2": 875766000 },
        "12": "Next Vision Limited",
        "13": 230
      }]
    });
    const normalized = normalizeCreative({ list: parsed.creatives[0] });

    expect(parsed.creatives[0]).toMatchObject({
      creativeId: "CR02768838851634921473",
      format: "IMAGE",
      publicDays: 230
    });
    expect(normalized.assets).toEqual([
      expect.objectContaining({
        kind: "LANDSCAPE_IMAGE",
        url: "https://tpc.googlesyndication.com/archive/simgad/10687578746076906992"
      })
    ]);
    expect(normalized.publicDays).toBe(230);
  });

  it("parses creative detail country stats and total impression range", () => {
    const parsed = parseCreativeDetails(detailResponse);

    expect(parsed.creativeId).toBe("CR06346342443637538817");
    expect(parsed.previewUrls).toHaveLength(2);
    expect(parsed.totalStats).toMatchObject({
      impressionsMin: 60000,
      impressionsMax: 70000,
      firstShownDate: "2025-03-07",
      lastShownDate: "2026-05-22",
      placementBreakdown: [
        expect.objectContaining({ platform: "GOOGLE_SEARCH", impressionsMin: 50000, impressionsMax: 60000 }),
        expect.objectContaining({ platform: "YOUTUBE", impressionsMin: 10000, impressionsMax: 15000 })
      ]
    });
    expect(parsed.countries).toEqual([
      expect.objectContaining({ countryCode: "BE", googleGeoId: 2056, impressionsMax: 1000, placementBreakdown: [expect.objectContaining({ platform: "YOUTUBE", impressionsMax: 1000 })] }),
      expect.objectContaining({ countryCode: "FR", googleGeoId: 2250, impressionsMin: 10000, impressionsMax: 15000, placementBreakdown: expect.arrayContaining([expect.objectContaining({ platform: "GOOGLE_SEARCH" })]) }),
      expect.objectContaining({ countryCode: "GB", googleGeoId: 2826, lastShownDate: "2026-05-22" })
    ]);
  });

  it("parses preview content.js app metadata and assets", () => {
    const parsed = parsePreviewContentJs(previewScript);

    expect(parsed).toMatchObject({
      appId: "com.flightsbooking.tickets.app",
      appName: "Billets et billets pas chers",
      store: "GOOGLE_PLAY",
      developer: "Cheap Flights Tickets App",
      category: "TRAVEL_AND_LOCAL",
      description: "Meilleurs prix pour les vols",
      shortDescription: "Recherchez des vols pas chers"
    });
    expect(parsed.assets.map((asset) => asset.kind)).toEqual(
      expect.arrayContaining(["LANDSCAPE_IMAGE", "APP_ICON", "SCREENSHOT", "COVER_IMAGE"])
    );
  });

  it("falls back to store click URL when preview metadata keys are absent", () => {
    const parsed = parsePreviewContentJs(String.raw`
      fletchCallback({"html":"<meta data-ifc=\"[[\"ad0\",[null,\"https://www.googleadservices.com/pagead/aclk?preview&amp;adurl=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.drone.assist\"]]\"></meta>"});
    `);

    expect(parsed).toMatchObject({
      appId: "com.drone.assist",
      store: "GOOGLE_PLAY",
      storeUrl: "https://play.google.com/store/apps/details?id=com.drone.assist"
    });
    expect(parsed.rawFields).toMatchObject({
      appId: "com.drone.assist",
      appStoreName: "Google Play"
    });
  });

  it("drops non-http preview URLs from assets and landing fields", () => {
    const parsed = parsePreviewContentJs(String.raw`
      var ad = {google_template_data: {'adData': [{
        'appId': 'com.safe.app',
        'appStore': '2',
        'landscapeImage': 'javascript:alert(1)',
        'destination_url': 'javascript:alert(2)',
        'appIconHighRes': 'data:image/svg+xml,<svg></svg>',
        'screenshot1': '//lh3.googleusercontent.com/safe'
      }]}};
    `);

    expect(parsed.landingUrl).toBeUndefined();
    expect(parsed.assets).toEqual([
      expect.objectContaining({ kind: "SCREENSHOT", url: "https://lh3.googleusercontent.com/safe" })
    ]);
  });

  it("ignores JavaScript member names that look like app ids", () => {
    const parsed = parsePreviewContentJs(String.raw`
      var ad = {
        "appStore": "2",
        "appId": "a.performance",
        "appName": "this.parentNode",
        "destination_url": "https://displayads-formats.googleusercontent.com/ads/preview/content.js"
      };
      this.parentNode && a.performance && "formats.googleusercontent.com";
    `);

    expect(parsed.appId).toBeUndefined();
    expect(parsed.appName).toBeUndefined();
    expect(parsed.storeUrl).toBeUndefined();
  });

  it("ignores date-like numbers as App Store ids", () => {
    const parsed = parsePreviewContentJs(String.raw`
      var AF_dataServiceRequests = {'ds:0': {request:[[{"361903925":[null,null,null,null,null,null,null,"Last shown 20260527","itunes.apple.com/",null,null,null,5,{"31":[{"57":[null,null,[1,"20260527",null,null,null,null,null,null,"",""]]}]}]}]]}}; 
    `);

    expect(parsed.appId).toBeUndefined();
    expect(parsed.appName).toBeUndefined();
    expect(parsed.storeUrl).toBeUndefined();
  });

  it("extracts embedded Google Play app data from rendered preview payloads", () => {
    const parsed = parsePreviewContentJs(String.raw`
      var AF_dataServiceRequests = {'ds:0': {request:[[{"361903925":[null,null,null,null,null,null,null,"Drohnen App: UAV Flugzonen | Drone Forecast zur Rettung","play.google.com/store","Wettervorhersage",null,null,5,{"31":[{"57":[null,null,[2,"com.drone.assist",null,null,null,null,null,null,"Drohnen App: UAV Flugzonen","DroneForecast"]]}]}]}]]}};
    `);

    expect(parsed).toMatchObject({
      appId: "com.drone.assist",
      appName: "Drohnen App: UAV Flugzonen",
      store: "GOOGLE_PLAY",
      storeUrl: "https://play.google.com/store/apps/details?id=com.drone.assist"
    });
  });

  it("extracts embedded App Store app data from rendered preview payloads", () => {
    const parsed = parsePreviewContentJs(String.raw`
      var AF_dataServiceRequests = {'ds:0': {request:[[{"361903925":[null,null,null,null,null,null,null,"QR Code &amp; 2D Barcode Scanner","itunes.apple.com/","Create your QR codes",null,null,5,{"31":[{"57":[null,null,[1,"1503971118",null,null,null,null,null,null,"QR Code & 2D Barcode Scanner","",""]]}]}]}]]}};
    `);

    expect(parsed).toMatchObject({
      appId: "1503971118",
      appName: "QR Code & 2D Barcode Scanner",
      store: "APP_STORE",
      storeUrl: "https://apps.apple.com/app/id1503971118"
    });
  });

  it("extracts app metadata from rendered asoch preview html", () => {
    const parsed = parsePreviewContentJs(String.raw`
      previewservice.insertPreviewHtmlContent('x', 'y', '<meta data-asoch-meta="[[[&quot;ad0&quot;,[null,&quot;https://www.googleadservices.com/pagead/aclk?preview&amp;adurl=&quot;,null,null,null,null,null,[null,&quot;&quot;,&quot;&quot;,&quot;com.drone.assist&quot;]]]]"></meta><a data-asoch-targets="ad0,ochAppName" dir="auto">Drone App</a><a data-asoch-targets="ad0,ochAppStore"></a>');
    `);

    expect(parsed).toMatchObject({
      appId: "com.drone.assist",
      appName: "Drone App",
      store: "GOOGLE_PLAY",
      storeUrl: "https://play.google.com/store/apps/details?id=com.drone.assist"
    });
  });

  it("normalizes list, detail and preview data into one creative card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));

    const list = parseSearchCreatives(searchResponse).creatives[0];
    const detail = parseCreativeDetails(detailResponse);
    const preview = parsePreviewContentJs(previewScript);
    const normalized = normalizeCreative({ list, detail, preview });

    expect(normalized.creativeId).toBe("CR06346342443637538817");
    expect(normalized.app?.appId).toBe("com.flightsbooking.tickets.app");
    expect(normalized.publicDays).toBeGreaterThan(900);
    expect(normalized.status).toBe("ACTIVE");
    expect(normalized.countries.map((country) => country.countryCode)).toEqual(["BE", "FR", "GB"]);
  });

  it("marks stale last shown creatives as stopped", () => {
    expect(resolveCreativeStatus(
      new Date("2026-02-06T22:03:36.000Z"),
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-23T00:00:00.000Z")
    )).toBe("STOPPED");
  });

  it("marks freshly recollected creatives as active even with old last shown date", () => {
    expect(resolveCreativeStatus(
      new Date("2026-02-06T22:03:36.000Z"),
      new Date("2026-06-22T12:00:00.000Z"),
      new Date("2026-06-23T00:00:00.000Z")
    )).toBe("ACTIVE");
  });

  it("extracts RPC calls and known regional ids from an API export", () => {
    const exportJson = {
      calls: [
        {
          url: "https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives",
          requestBody: "f.req=%7B%222%22%3A40%2C%223%22%3A%7B%228%22%3A%5B2826%5D%7D%7D",
          responseBody: JSON.stringify(searchResponse)
        }
      ]
    };

    const calls = extractRpcCalls(exportJson);

    expect(calls[0]).toMatchObject({
      service: "SearchService",
      method: "SearchCreatives",
      request: { "2": 40, "3": { "8": [2826] } }
    });
    expect(getGeoTarget(2826)).toMatchObject({ countryCode: "GB" });
    expect(getGeoTarget(2056)).toMatchObject({ countryCode: "BE" });
    expect(getGeoTarget(2028)).toMatchObject({ countryCode: "AG" });
  });
});
