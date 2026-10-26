import type { Prisma } from "@ad-monitor/db";
import { parseCreativeDetails, parsePlacementBreakdown } from "@ad-monitor/core";
import { computeCreativeStatus, serialize } from "./utils.js";

const TITLE_STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "this", "that", "from", "into", "make", "more", "best",
  "app", "ads", "google", "play", "store", "install", "get", "new", "you", "now", "free", "pro"
]);

const DESCRIPTION_STOPWORDS = new Set([
  ...TITLE_STOPWORDS,
  "are", "our", "all", "can", "use", "video", "videos", "photo", "photos", "easy", "fast"
]);

export type CreativeStyle =
  | "APP_INSTALL"
  | "VIDEO_DEMO"
  | "IMAGE_HEAVY"
  | "UTILITY_FOCUSED"
  | "SOCIAL_LIFESTYLE"
  | "BEFORE_AFTER"
  | "MIXED"
  | "UNKNOWN";

export const REFERENCE_CREATIVE_SELECT = {
  id: true,
  creativeId: true,
  advertiserId: true,
  appDbId: true,
  title: true,
  description: true,
  format: true,
  status: true,
  previewUrl: true,
  firstShownAt: true,
  lastShownAt: true,
  publicDays: true,
  impressionsMin: true,
  impressionsMax: true,
  firstFoundAt: true,
  lastFoundAt: true,
  detailFetchedAt: true,
  createdAt: true,
  updatedAt: true,
  rawList: true,
  rawDetail: true,
  rawPreview: true,
  advertiser: {
    select: {
      id: true,
      googleAdvertiserId: true,
      name: true
    }
  },
  app: {
    select: {
      id: true,
      appId: true,
      store: true,
      storeUrl: true,
      name: true,
      developer: true,
      category: true,
      description: true,
      shortDescription: true
    }
  },
  countries: {
    select: {
      id: true,
      googleGeoId: true,
      countryCode: true,
      countryName: true,
      impressionsMin: true,
      impressionsMax: true,
      firstShownDate: true,
      lastShownDate: true,
      raw: true,
      updatedAt: true
    },
    orderBy: [{ impressionsMax: "desc" }, { updatedAt: "desc" }]
  },
  assets: {
    select: {
      id: true,
      kind: true,
      url: true,
      width: true,
      height: true
    }
  },
  _count: {
    select: {
      countries: true,
      assets: true,
      rawSnapshots: true
    }
  }
} satisfies Prisma.CreativeSelect;

export type ReferenceCreativeRecord = Prisma.CreativeGetPayload<{ select: typeof REFERENCE_CREATIVE_SELECT }>;

export type ReferenceCoverage = {
  hasTitle: boolean;
  hasDescription: boolean;
  hasGeo: boolean;
  hasVideo: boolean;
  hasImage: boolean;
  hasApp: boolean;
  hasDetails: boolean;
  hasPreview: boolean;
  hasAssets: boolean;
  assetKinds: string[];
  countriesCount: number;
  assetsCount: number;
  rawSnapshotsCount: number;
};

export function resolveCreativeTitle(creative: Pick<ReferenceCreativeRecord, "title" | "app">) {
  const candidate = creative.title?.trim() || creative.app?.name?.trim() || "";
  return candidate || null;
}

export function resolveCreativeDescription(creative: Pick<ReferenceCreativeRecord, "description" | "app">) {
  const candidate = creative.description?.trim() || creative.app?.description?.trim() || "";
  return candidate || null;
}

export function getCreativeCoverage(creative: ReferenceCreativeRecord): ReferenceCoverage {
  const assetKinds = [...new Set(creative.assets.map((asset) => asset.kind))];
  return {
    hasTitle: Boolean(resolveCreativeTitle(creative)),
    hasDescription: Boolean(resolveCreativeDescription(creative)),
    hasGeo: creative.countries.length > 0,
    hasVideo: assetKinds.includes("VIDEO"),
    hasImage: assetKinds.some((kind) => kind !== "VIDEO" && kind !== "LANDING_URL"),
    hasApp: Boolean(creative.appDbId),
    hasDetails: Boolean(creative.detailFetchedAt || creative.rawDetail),
    hasPreview: Boolean(creative.previewUrl || creative.rawPreview),
    hasAssets: creative.assets.length > 0,
    assetKinds,
    countriesCount: creative._count.countries,
    assetsCount: creative._count.assets,
    rawSnapshotsCount: creative._count.rawSnapshots
  };
}

export function getCreativeIssues(creative: ReferenceCreativeRecord) {
  const coverage = getCreativeCoverage(creative);
  const issues: string[] = [];
  if (!coverage.hasApp) issues.push("missing_app_link");
  if (!coverage.hasDetails) issues.push("missing_details");
  if (!coverage.hasPreview) issues.push("missing_preview");
  if (!coverage.hasGeo) issues.push("missing_geo");
  if (!coverage.hasTitle) issues.push("missing_title");
  if (!coverage.hasDescription) issues.push("missing_description");
  if (!coverage.hasAssets) issues.push("missing_assets");
  const expectedStatus = computeCreativeStatus(creative.lastShownAt, creative.lastFoundAt);
  if (expectedStatus !== creative.status) issues.push("status_out_of_sync");
  return issues;
}

export function computeReferenceScore(creative: ReferenceCreativeRecord) {
  const coverage = getCreativeCoverage(creative);
  const structure = getTextStructure(creative);
  const style = classifyCreativeStyle(creative);
  const issues = getCreativeIssues(creative);
  const reasons: string[] = [];
  let score = 0;

  if (creative.status === "ACTIVE") {
    score += 35;
    reasons.push("active_status");
  } else if (creative.status === "STOPPED") {
    score += 8;
  }

  const publicDays = creative.publicDays ?? 0;
  if (publicDays >= 365) {
    score += 20;
    reasons.push("long_runtime_365_plus");
  } else if (publicDays >= 180) {
    score += 16;
    reasons.push("long_runtime_180_plus");
  } else if (publicDays >= 60) {
    score += 10;
    reasons.push("runtime_60_plus");
  } else if (publicDays >= 14) {
    score += 5;
  }

  const countriesCount = coverage.countriesCount;
  if (countriesCount >= 20) {
    score += 15;
    reasons.push("wide_geo_20_plus");
  } else if (countriesCount >= 8) {
    score += 10;
    reasons.push("wide_geo_8_plus");
  } else if (countriesCount >= 3) {
    score += 5;
  }

  if (coverage.hasTitle) {
    score += 6;
    reasons.push("has_title");
  }
  if (coverage.hasDescription) {
    score += 6;
    reasons.push("has_description");
  }
  if (coverage.hasAssets) {
    score += 8;
    reasons.push("has_assets");
  }
  if (coverage.hasVideo) {
    score += 4;
    reasons.push("has_video");
  } else if (coverage.hasImage) {
    score += 2;
  }
  if (coverage.hasDetails) score += 3;
  if (coverage.hasApp) score += 3;
  if (structure.hasCta) {
    score += 4;
    reasons.push("has_cta");
  }
  if (structure.titleLength >= 18 && structure.titleLength <= 42) {
    score += 4;
    reasons.push("balanced_title_length");
  }
  if (structure.descriptionLength >= 40 && structure.descriptionLength <= 160) {
    score += 4;
    reasons.push("balanced_description_length");
  }
  if (style === "APP_INSTALL" || style === "VIDEO_DEMO" || style === "IMAGE_HEAVY") {
    score += 3;
    reasons.push(`clear_style_${style.toLowerCase()}`);
  }

  const lastShownAt = creative.lastShownAt?.getTime() ?? 0;
  if (lastShownAt > 0) {
    const ageDays = (Date.now() - lastShownAt) / 86_400_000;
    if (ageDays <= 3) {
      score += 10;
      reasons.push("recent_last_shown_3d");
    } else if (ageDays <= 14) {
      score += 6;
      reasons.push("recent_last_shown_14d");
    } else if (ageDays <= 30) {
      score += 3;
    }
  }

  if (issues.length) {
    score -= Math.min(18, issues.length * 3);
    reasons.push("quality_penalty_for_missing_data");
  }
  if (!coverage.hasGeo && publicDays < 14) score -= 4;
  if (!coverage.hasTitle && !coverage.hasDescription) score -= 8;

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons
  };
}

export function toReferenceCreative(creative: ReferenceCreativeRecord) {
  const coverage = getCreativeCoverage(creative);
  const scoring = computeReferenceScore(creative);
  const style = classifyCreativeStyle(creative);
  const structure = getTextStructure(creative);
  return serialize({
    ...creative,
    title: resolveCreativeTitle(creative),
    description: resolveCreativeDescription(creative),
    placementBreakdown: getTotalPlacementBreakdown(creative),
    countries: creative.countries.map(({ raw, ...country }) => ({
      ...country,
      placementBreakdown: getCountryPlacementBreakdown(raw)
    })),
    coverage,
    issues: getCreativeIssues(creative),
    creativeStyle: style,
    textStructure: structure,
    primaryHook: detectPrimaryHook(creative),
    referenceScore: scoring.score,
    referenceReasons: scoring.reasons
  });
}

function getTotalPlacementBreakdown(creative: Pick<ReferenceCreativeRecord, "rawDetail">) {
  if (!creative.rawDetail) return [];
  return parseCreativeDetails(creative.rawDetail).totalStats?.placementBreakdown ?? [];
}

function getCountryPlacementBreakdown(raw: unknown) {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return parsePlacementBreakdown(row["8"]);
}

export function compareCreatives(creatives: ReferenceCreativeRecord[]) {
  return creatives.map((creative) => {
    const coverage = getCreativeCoverage(creative);
    const scoring = computeReferenceScore(creative);
    return serialize({
      creativeId: creative.creativeId,
      advertiserName: creative.advertiser?.name ?? creative.advertiser?.googleAdvertiserId ?? null,
      title: resolveCreativeTitle(creative),
      description: resolveCreativeDescription(creative),
      format: creative.format,
      status: creative.status,
      store: creative.app?.store ?? "UNKNOWN",
      developer: creative.app?.developer ?? null,
      category: creative.app?.category ?? null,
      creativeStyle: classifyCreativeStyle(creative),
      primaryHook: detectPrimaryHook(creative),
      publicDays: creative.publicDays,
      firstShownAt: creative.firstShownAt,
      lastShownAt: creative.lastShownAt,
      countriesCount: coverage.countriesCount,
      assetKinds: coverage.assetKinds,
      assetsCount: coverage.assetsCount,
      referenceScore: scoring.score
    });
  });
}

export function buildPatterns(creatives: ReferenceCreativeRecord[]) {
  const titleWords = countWords(creatives.map((creative) => resolveCreativeTitle(creative)), TITLE_STOPWORDS);
  const descriptionWords = countWords(creatives.map((creative) => resolveCreativeDescription(creative)), DESCRIPTION_STOPWORDS);
  const descriptionPhrases = countBigrams(creatives.map((creative) => resolveCreativeDescription(creative)), DESCRIPTION_STOPWORDS);
  return serialize({
    totalCreatives: creatives.length,
    titleWords: topEntries(titleWords),
    descriptionWords: topEntries(descriptionWords),
    descriptionPhrases: topEntries(descriptionPhrases),
    formats: topEntries(countBy(creatives.map((creative) => creative.format))),
    stores: topEntries(countBy(creatives.map((creative) => creative.app?.store ?? "UNKNOWN"))),
    categories: topEntries(countBy(creatives.map((creative) => creative.app?.category ?? "UNKNOWN"))),
    developers: topEntries(countBy(creatives.map((creative) => creative.app?.developer ?? "UNKNOWN"))),
    geo: topEntries(countBy(creatives.flatMap((creative) => creative.countries.map((country) => country.countryCode ?? "UNKNOWN")))),
    assetComposition: topEntries(countBy(creatives.map(assetCompositionLabel))),
    creativeStyles: topEntries(countBy(creatives.map((creative) => classifyCreativeStyle(creative)))),
    primaryHooks: topEntries(countBy(creatives.map((creative) => detectPrimaryHook(creative))))
  });
}

export function buildReferenceSummary(creatives: ReferenceCreativeRecord[]) {
  const patterns = buildPatterns(creatives) as ReturnType<typeof serialize>;
  const scores = creatives.map((creative) => computeReferenceScore(creative).score);
  const activeCount = creatives.filter((creative) => creative.status === "ACTIVE").length;
  return serialize({
    totalCreatives: creatives.length,
    activeCreatives: activeCount,
    averageReferenceScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0,
    topTitleWords: (patterns as any).titleWords?.slice(0, 5) ?? [],
    topDescriptionPhrases: (patterns as any).descriptionPhrases?.slice(0, 5) ?? [],
    dominantFormats: (patterns as any).formats?.slice(0, 3) ?? [],
    dominantGeo: (patterns as any).geo?.slice(0, 5) ?? [],
    dominantDevelopers: (patterns as any).developers?.slice(0, 5) ?? [],
    dominantStyles: (patterns as any).creativeStyles?.slice(0, 5) ?? [],
    dominantHooks: (patterns as any).primaryHooks?.slice(0, 5) ?? [],
    assetComposition: (patterns as any).assetComposition?.slice(0, 5) ?? []
  });
}

export function computeSimilarity(anchor: ReferenceCreativeRecord, candidate: ReferenceCreativeRecord) {
  const reasons: string[] = [];
  let score = 0;
  const anchorStyle = classifyCreativeStyle(anchor);
  const candidateStyle = classifyCreativeStyle(candidate);
  const anchorStructure = getTextStructure(anchor);
  const candidateStructure = getTextStructure(candidate);

  if (anchor.app?.store && anchor.app.store === candidate.app?.store) {
    score += 10;
    reasons.push("same_store");
  }
  if (anchor.app?.appId && anchor.app.appId === candidate.app?.appId) {
    score += 30;
    reasons.push("same_app");
  }
  if (anchor.app?.developer && anchor.app.developer === candidate.app?.developer) {
    score += 15;
    reasons.push("same_developer");
  }
  if (anchor.app?.category && anchor.app.category === candidate.app?.category) {
    score += 10;
    reasons.push("same_category");
  }
  if (anchor.format === candidate.format) {
    score += 10;
    reasons.push("same_format");
  }
  if (anchorStyle !== "UNKNOWN" && anchorStyle === candidateStyle) {
    score += 14;
    reasons.push("same_creative_style");
  }

  const anchorCountries = new Set(anchor.countries.map((country) => country.countryCode).filter(Boolean));
  const candidateCountries = new Set(candidate.countries.map((country) => country.countryCode).filter(Boolean));
  const sharedCountries = [...anchorCountries].filter((country) => candidateCountries.has(country));
  if (sharedCountries.length) {
    score += Math.min(10, sharedCountries.length * 2);
    reasons.push(`shared_geo_${sharedCountries.length}`);
  }

  const anchorWords = new Set(tokenize([resolveCreativeTitle(anchor), resolveCreativeDescription(anchor)].filter(Boolean).join(" "), DESCRIPTION_STOPWORDS));
  const candidateWords = new Set(tokenize([resolveCreativeTitle(candidate), resolveCreativeDescription(candidate)].filter(Boolean).join(" "), DESCRIPTION_STOPWORDS));
  const sharedWords = [...anchorWords].filter((word) => candidateWords.has(word));
  if (sharedWords.length) {
    score += Math.min(10, sharedWords.length * 2);
    reasons.push("text_overlap");
  }

  const anchorHook = detectPrimaryHook(anchor);
  const candidateHook = detectPrimaryHook(candidate);
  if (anchorHook !== "generic" && anchorHook === candidateHook) {
    score += 10;
    reasons.push("same_primary_hook");
  }
  if (Math.abs(anchorStructure.titleLength - candidateStructure.titleLength) <= 12) {
    score += 5;
    reasons.push("similar_title_length");
  }
  if (Math.abs(anchorStructure.descriptionLength - candidateStructure.descriptionLength) <= 40) {
    score += 4;
    reasons.push("similar_description_length");
  }
  if (anchorStructure.hasCta === candidateStructure.hasCta) {
    score += 3;
    reasons.push("same_cta_presence");
  }

  const anchorKinds = new Set(anchor.assets.map((asset) => asset.kind));
  const candidateKinds = new Set(candidate.assets.map((asset) => asset.kind));
  const sharedKinds = [...anchorKinds].filter((kind) => candidateKinds.has(kind));
  if (sharedKinds.length) {
    score += Math.min(5, sharedKinds.length * 2);
    reasons.push("asset_overlap");
  }

  const anchorCoverage = getCreativeCoverage(anchor);
  const candidateCoverage = getCreativeCoverage(candidate);
  if (anchorCoverage.hasVideo !== candidateCoverage.hasVideo) score -= 4;
  if (anchorCoverage.hasImage !== candidateCoverage.hasImage) score -= 2;
  if ((anchorCountries.size >= 8) !== (candidateCountries.size >= 8)) score -= 4;
  if (!candidateCoverage.hasTitle && !candidateCoverage.hasDescription) score -= 10;

  return {
    score: Math.max(0, score),
    reasons
  };
}

export function buildReferencePackInsights(creatives: ReferenceCreativeRecord[]) {
  const summary = buildReferenceSummary(creatives) as any;
  const patterns = buildPatterns(creatives) as any;
  return serialize({
    whyThisPack: buildWhyThisPack(summary),
    commonHooks: (patterns.primaryHooks ?? []).slice(0, 5),
    reusableElements: buildReusableElements(creatives),
    riskNotes: buildRiskNotes(creatives)
  });
}

function countWords(values: Array<string | null>, stopwords: Set<string>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const word of tokenize(value ?? "", stopwords)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}

function countBigrams(values: Array<string | null>, stopwords: Set<string>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const words = tokenize(value ?? "", stopwords);
    for (let index = 0; index < words.length - 1; index += 1) {
      const phrase = `${words[index]} ${words[index + 1]}`;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return counts;
}

function tokenize(value: string, stopwords: Set<string>) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stopwords.has(item));
}

function countBy(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim() || "UNKNOWN";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topEntries(counts: Map<string, number>, take = 10) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, take)
    .map(([value, count]) => ({ value, count }));
}

function assetCompositionLabel(creative: ReferenceCreativeRecord) {
  const coverage = getCreativeCoverage(creative);
  if (coverage.hasVideo && coverage.hasImage) return "video_and_image";
  if (coverage.hasVideo) return "video_only";
  if (coverage.hasImage) return "image_only";
  if (coverage.hasAssets) return "other_assets_only";
  return "no_assets";
}

function getTextStructure(creative: ReferenceCreativeRecord) {
  const title = resolveCreativeTitle(creative) ?? "";
  const description = resolveCreativeDescription(creative) ?? "";
  const combined = `${title} ${description}`.trim();
  const cta = extractCta(combined);
  return {
    titleLength: title.length,
    descriptionLength: description.length,
    hasCta: Boolean(cta),
    cta,
    titleWordCount: title ? title.split(/\s+/).length : 0,
    descriptionWordCount: description ? description.split(/\s+/).length : 0
  };
}

function classifyCreativeStyle(creative: ReferenceCreativeRecord): CreativeStyle {
  const coverage = getCreativeCoverage(creative);
  const text = `${resolveCreativeTitle(creative) ?? ""} ${resolveCreativeDescription(creative) ?? ""}`.toLowerCase();
  if (/\bbefore\b.*\bafter\b|\btransform\b|\bresults\b/.test(text)) return "BEFORE_AFTER";
  if (/\bchat\b|\bfriends\b|\bsocial\b|\bshare\b|\blove\b/.test(text)) return "SOCIAL_LIFESTYLE";
  if (/\btool\b|\bedit\b|\bconvert\b|\bscan\b|\bclean\b|\bcompress\b|\btemplate\b/.test(text)) return "UTILITY_FOCUSED";
  if (coverage.hasVideo && /\bdemo\b|\bwatch\b|\bsee\b|\bhow\b/.test(text)) return "VIDEO_DEMO";
  if (coverage.hasVideo && coverage.hasImage) return "MIXED";
  if (coverage.hasVideo) return "VIDEO_DEMO";
  if (coverage.hasImage && /\binstall\b|\bdownload\b|\bapp store\b|\bgoogle play\b/.test(text)) return "APP_INSTALL";
  if (coverage.hasImage) return "IMAGE_HEAVY";
  return "UNKNOWN";
}

function detectPrimaryHook(creative: ReferenceCreativeRecord) {
  const text = `${resolveCreativeTitle(creative) ?? ""} ${resolveCreativeDescription(creative) ?? ""}`.toLowerCase();
  if (/\bfree\b|\btrial\b|\bdiscount\b|\bsave\b/.test(text)) return "offer";
  if (/\bfast\b|\beasy\b|\bquick\b|\bone tap\b|\bin seconds\b/.test(text)) return "ease_speed";
  if (/\btemplates?\b|\bedit\b|\bcreate\b|\bmake\b|\bdesign\b/.test(text)) return "creation";
  if (/\bprivate\b|\bsecure\b|\bprotect\b/.test(text)) return "trust_safety";
  if (/\binstall\b|\bdownload\b|\bget\b|\btry\b|\bstart\b/.test(text)) return "direct_cta";
  if (/\bbefore\b|\bafter\b|\bresults\b/.test(text)) return "transformation";
  return "generic";
}

function extractCta(text: string) {
  const lower = text.toLowerCase();
  const patterns = [
    "install now",
    "download now",
    "try now",
    "get started",
    "start now",
    "install",
    "download",
    "try",
    "get",
    "start"
  ];
  return patterns.find((pattern) => lower.includes(pattern)) ?? null;
}

function buildWhyThisPack(summary: any) {
  const lines: string[] = [];
  if (summary.activeCreatives > 0) lines.push(`contains ${summary.activeCreatives} active creatives`);
  if (summary.averageReferenceScore >= 70) lines.push(`average reference score is strong at ${summary.averageReferenceScore}`);
  const topStyle = summary.dominantStyles?.[0]?.value;
  if (topStyle && topStyle !== "UNKNOWN") lines.push(`dominant style is ${String(topStyle).toLowerCase()}`);
  const topHook = summary.dominantHooks?.[0]?.value;
  if (topHook && topHook !== "generic") lines.push(`recurring hook is ${String(topHook).toLowerCase()}`);
  const topGeo = summary.dominantGeo?.[0]?.value;
  if (topGeo && topGeo !== "UNKNOWN") lines.push(`most common geo is ${topGeo}`);
  return lines.slice(0, 5);
}

function buildReusableElements(creatives: ReferenceCreativeRecord[]) {
  const styles = topEntries(countBy(creatives.map((creative) => classifyCreativeStyle(creative))), 3).map((item) => item.value);
  const hooks = topEntries(countBy(creatives.map((creative) => detectPrimaryHook(creative))), 5)
    .map((item) => item.value)
    .filter((item) => item !== "generic");
  const ctas = topEntries(countBy(creatives.map((creative) => getTextStructure(creative).cta ?? "none")), 5)
    .map((item) => item.value)
    .filter((item) => item !== "none");
  return {
    dominantStyles: styles,
    dominantHooks: hooks,
    repeatedCtas: ctas
  };
}

function buildRiskNotes(creatives: ReferenceCreativeRecord[]) {
  const notes: string[] = [];
  const weak = creatives.filter((creative) => getCreativeIssues(creative).length >= 3).length;
  const noGeo = creatives.filter((creative) => getCreativeCoverage(creative).hasGeo === false).length;
  const noText = creatives.filter((creative) => {
    const coverage = getCreativeCoverage(creative);
    return !coverage.hasTitle && !coverage.hasDescription;
  }).length;
  if (weak > 0) notes.push(`${weak} creatives have major data gaps`);
  if (noGeo > 0) notes.push(`${noGeo} creatives are missing geo coverage`);
  if (noText > 0) notes.push(`${noText} creatives are missing usable text`);
  if (!notes.length) notes.push("pack quality is stable with no major coverage gaps");
  return notes;
}
