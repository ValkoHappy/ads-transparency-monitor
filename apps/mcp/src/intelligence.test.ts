import { describe, expect, it } from "vitest";
import {
  buildPatterns,
  buildReferencePackInsights,
  buildReferenceSummary,
  compareCreatives,
  computeReferenceScore,
  computeSimilarity,
  getCreativeCoverage,
  getCreativeIssues,
  resolveCreativeDescription,
  resolveCreativeTitle,
  toReferenceCreative,
  type ReferenceCreativeRecord
} from "./intelligence.js";

function makeCreative(overrides: Partial<ReferenceCreativeRecord> = {}): ReferenceCreativeRecord {
  return {
    id: "creative-1",
    creativeId: "CR10000000000000000001",
    advertiserId: "adv-1",
    appDbId: "app-1",
    title: "Collage Maker - CollageKit",
    description: "Combine photos and videos into stylish collages.",
    format: "IMAGE",
    status: "ACTIVE",
    previewUrl: "https://example.com/preview",
    firstShownAt: new Date("2026-01-01T00:00:00.000Z"),
    lastShownAt: new Date(),
    publicDays: 180,
    impressionsMin: 1000,
    impressionsMax: 5000,
    firstFoundAt: new Date("2026-01-05T00:00:00.000Z"),
    lastFoundAt: new Date(),
    detailFetchedAt: new Date(),
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    updatedAt: new Date(),
    rawList: null,
    rawDetail: { ok: true },
    rawPreview: { ok: true },
    advertiser: {
      id: "adv-1",
      googleAdvertiserId: "AR1234567890",
      name: "Sarafan Mobile"
    },
    app: {
      id: "app-1",
      appId: "6743087764",
      store: "APP_STORE",
      storeUrl: "https://apps.apple.com/app/id6743087764",
      name: "Collage Maker - CollageKit",
      developer: "Programacion Viktor Seraleev EIRL",
      category: "Photo",
      description: "Combine photos and videos into stylish collages.",
      shortDescription: "Stylish collages"
    },
    countries: [
      {
        id: "country-1",
        googleGeoId: 2840,
        countryCode: "US",
        countryName: "United States",
        impressionsMin: 100,
        impressionsMax: 500,
        firstShownDate: "2026-01-01",
        lastShownDate: "2026-06-20",
        raw: {},
        updatedAt: new Date()
      }
    ],
    assets: [
      {
        id: "asset-1",
        kind: "LANDSCAPE_IMAGE",
        url: "https://example.com/image.jpg",
        width: 1200,
        height: 628
      },
      {
        id: "asset-2",
        kind: "VIDEO",
        url: "https://example.com/video.mp4",
        width: 1080,
        height: 1920
      }
    ],
    _count: {
      countries: 1,
      assets: 2,
      rawSnapshots: 3
    },
    ...overrides
  };
}

describe("mcp intelligence helpers", () => {
  it("computes coverage and score for a strong reference creative", () => {
    const creative = makeCreative();
    expect(getCreativeCoverage(creative)).toMatchObject({
      hasTitle: true,
      hasDescription: true,
      hasGeo: true,
      hasVideo: true,
      hasImage: true,
      hasApp: true,
      hasDetails: true,
      hasPreview: true,
      hasAssets: true
    });
    const scoring = computeReferenceScore(creative);
    expect(scoring.score).toBeGreaterThan(60);
    expect(scoring.reasons).toContain("active_status");
    expect(scoring.reasons).toContain("balanced_description_length");
  });

  it("reports missing fields as issues", () => {
    const creative = makeCreative({
      title: "",
      description: "",
      appDbId: null,
      app: {
        id: "app-1",
        appId: "6743087764",
        store: "APP_STORE",
        storeUrl: "https://apps.apple.com/app/id6743087764",
        name: "",
        developer: "Programacion Viktor Seraleev EIRL",
        category: "Photo",
        description: "",
        shortDescription: "Stylish collages"
      },
      previewUrl: null,
      detailFetchedAt: null,
      rawDetail: null,
      rawPreview: null,
      assets: [],
      countries: [],
      _count: {
        countries: 0,
        assets: 0,
        rawSnapshots: 0
      }
    });
    expect(getCreativeIssues(creative)).toEqual(expect.arrayContaining([
      "missing_app_link",
      "missing_details",
      "missing_preview",
      "missing_geo",
      "missing_title",
      "missing_description",
      "missing_assets"
    ]));
  });

  it("finds similarity reasons between nearby creatives", () => {
    const anchor = makeCreative();
    const candidate = makeCreative({
      id: "creative-2",
      creativeId: "CR10000000000000000002",
      title: "Collage maker app",
      description: "Stylish collage templates for videos and photos."
    });
    const similarity = computeSimilarity(anchor, candidate);
    expect(similarity.score).toBeGreaterThan(30);
    expect(similarity.reasons).toContain("same_app");
    expect(similarity.reasons).toContain("same_creative_style");
  });

  it("builds pattern, summary, comparison and pack insights outputs", () => {
    const creatives = [
      makeCreative(),
      makeCreative({
        id: "creative-3",
        creativeId: "CR10000000000000000003",
        title: "Install Collage Maker now",
        description: "Make collages from photos quickly with easy templates.",
        countries: [
          {
            id: "country-2",
            googleGeoId: 2826,
            countryCode: "GB",
            countryName: "United Kingdom",
            impressionsMin: 50,
            impressionsMax: 200,
            firstShownDate: "2026-01-01",
            lastShownDate: "2026-06-20",
            raw: {},
            updatedAt: new Date()
          }
        ],
        _count: {
          countries: 1,
          assets: 2,
          rawSnapshots: 2
        }
      })
    ];

    const patterns = buildPatterns(creatives);
    const summary = buildReferenceSummary(creatives);
    const comparison = compareCreatives(creatives);
    const referenceCard = toReferenceCreative(creatives[0]);
    const insights = buildReferencePackInsights(creatives);

    expect((patterns as any).titleWords.length).toBeGreaterThan(0);
    expect((patterns as any).creativeStyles.length).toBeGreaterThan(0);
    expect((patterns as any).primaryHooks.length).toBeGreaterThan(0);
    expect((summary as any).totalCreatives).toBe(2);
    expect((summary as any).dominantStyles.length).toBeGreaterThan(0);
    expect(comparison).toHaveLength(2);
    expect(referenceCard).toMatchObject({
      title: "Collage Maker - CollageKit"
    });
    expect((referenceCard as any).creativeStyle).toBeTruthy();
    expect((referenceCard as any).primaryHook).toBeTruthy();
    expect((referenceCard as any).textStructure).toBeTruthy();
    expect((insights as any).whyThisPack.length).toBeGreaterThan(0);
    expect((insights as any).reusableElements).toBeTruthy();
    expect((insights as any).riskNotes.length).toBeGreaterThan(0);
    expect(resolveCreativeTitle(creatives[0])).toBeTruthy();
    expect(resolveCreativeDescription(creatives[0])).toBeTruthy();
  });
});
