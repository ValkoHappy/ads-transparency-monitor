import { parseCreativeDetails, parsePreviewContentJs } from "@ad-monitor/core";
import { prisma, validateWorkerEnv } from "@ad-monitor/db";
import { collectBestPreview, normalizeGooglePreviewUrl } from "../apps/worker/src/google-client";

type BackfillArgs = {
  write: boolean;
  dryRun: boolean;
  limit: number;
  concurrency: number;
  creativeId?: string;
};

type BackfillReason =
  | "NO_PREVIEW_URL"
  | "PREVIEW_FETCH_FAILED"
  | "PREVIEW_WITHOUT_APP"
  | "PREVIEW_WITHOUT_STORE"
  | "UPDATED"
  | "WOULD_UPDATE";

type BackfillResult = {
  creativeId: string;
  reason: BackfillReason;
  appId?: string;
  store?: string;
  error?: string;
};

const args = parseArgs(process.argv.slice(2));

validateWorkerEnv();

if (!args.write && !args.dryRun) {
  args.dryRun = true;
}

const creatives = await prisma.creative.findMany({
  where: {
    ...(args.creativeId ? { creativeId: args.creativeId } : { appDbId: null })
  },
  orderBy: { updatedAt: "desc" },
  take: args.limit,
  select: {
    id: true,
    creativeId: true,
    previewUrl: true,
    rawPreview: true,
    rawDetail: true
  }
});

const results = await mapWithConcurrency(creatives, args.concurrency, async (creative): Promise<BackfillResult> => {
  const previewUrls = previewUrlsForCreative(creative.previewUrl, creative.rawDetail);
  if (!previewUrls.length) {
    return { creativeId: creative.creativeId, reason: "NO_PREVIEW_URL" };
  }

  let preview: ReturnType<typeof parsePreviewContentJs> | undefined;
  try {
    preview = await collectBestPreview(previewUrls, fetchPreviewContent);
  } catch (error) {
    return { creativeId: creative.creativeId, reason: "PREVIEW_FETCH_FAILED", error: errorMessage(error) };
  }

  if (!preview?.appId) {
    return { creativeId: creative.creativeId, reason: "PREVIEW_WITHOUT_APP" };
  }
  if (preview.store === "UNKNOWN") {
    return { creativeId: creative.creativeId, reason: "PREVIEW_WITHOUT_STORE", appId: preview.appId, store: preview.store };
  }

  if (!args.write) {
    return { creativeId: creative.creativeId, reason: "WOULD_UPDATE", appId: preview.appId, store: preview.store };
  }

  const app = await prisma.app.upsert({
    where: {
      store_appId: {
        store: preview.store,
        appId: preview.appId
      }
    },
    create: {
      store: preview.store,
      appId: preview.appId,
      storeUrl: preview.storeUrl,
      name: preview.appName,
      developer: preview.developer,
      category: preview.category,
      description: preview.description,
      shortDescription: preview.shortDescription
    },
    update: {
      storeUrl: preview.storeUrl,
      name: preview.appName,
      developer: preview.developer,
      category: preview.category,
      description: preview.description,
      shortDescription: preview.shortDescription,
      lastSeenAt: new Date()
    }
  });

  await prisma.creative.update({
    where: { id: creative.id },
    data: {
      appDbId: app.id,
      rawPreview: preview.rawFields
    }
  });

  await Promise.all(preview.assets.map((asset) => prisma.creativeAsset.upsert({
    where: {
      creativeId_kind_url: {
        creativeId: creative.id,
        kind: asset.kind,
        url: asset.url
      }
    },
    create: {
      creativeId: creative.id,
      kind: asset.kind,
      url: asset.url,
      width: asset.width,
      height: asset.height
    },
    update: {
      width: asset.width,
      height: asset.height
    }
  })));

  return { creativeId: creative.creativeId, reason: "UPDATED", appId: preview.appId, store: preview.store };
});

printReport(results, args);
await prisma.$disconnect();

function parseArgs(values: string[]): BackfillArgs {
  const parsed: BackfillArgs = {
    write: false,
    dryRun: false,
    limit: 100,
    concurrency: 3
  };

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    const next = values[index + 1];
    if (arg === "--write") parsed.write = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--limit" && next) {
      parsed.limit = positiveInt(next, "--limit");
      index += 1;
    } else if (arg === "--concurrency" && next) {
      parsed.concurrency = positiveInt(next, "--concurrency");
      index += 1;
    } else if (arg === "--creative-id" && next) {
      parsed.creativeId = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.concurrency = Math.min(10, parsed.concurrency);
  return parsed;
}

function positiveInt(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function previewUrlsForCreative(previewUrl: string | null, rawDetail: unknown) {
  const detailUrls = rawDetail ? safeDetailPreviewUrls(rawDetail) : [];
  return [...new Set([previewUrl ?? undefined, ...detailUrls].filter((url): url is string => Boolean(url)))];
}

function safeDetailPreviewUrls(rawDetail: unknown) {
  try {
    return parseCreativeDetails(rawDetail).previewUrls;
  } catch {
    return [];
  }
}

async function fetchPreviewContent(previewUrl: string) {
  const response = await fetch(normalizeGooglePreviewUrl(previewUrl), {
    headers: { "user-agent": defaultUserAgent() },
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parsePreviewContentJs(await response.text());
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

function printReport(results: BackfillResult[], input: BackfillArgs) {
  const counts = new Map<BackfillReason, number>();
  for (const result of results) counts.set(result.reason, (counts.get(result.reason) ?? 0) + 1);

  console.log(`Backfill mode: ${input.write ? "write" : "dry-run"}`);
  console.log(`Checked creatives: ${results.length}`);
  for (const [reason, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${reason}: ${count}`);
  }

  const unresolved = results.filter((result) => !["UPDATED", "WOULD_UPDATE"].includes(result.reason));
  if (unresolved.length) {
    console.log("Unresolved creatives:");
    for (const result of unresolved.slice(0, 50)) {
      console.log(`${result.creativeId} ${result.reason}${result.error ? ` ${result.error}` : ""}`);
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function defaultUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136 Safari/537.36";
}
