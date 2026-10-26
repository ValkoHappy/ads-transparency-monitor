import { createGoogleClient } from "../apps/worker/src/browser-google-client";

const advertiserId = process.env.SMOKE_ADVERTISER_ID ?? "AR14577439029227159553";
const geoId = process.env.SMOKE_GEO_ID ? Number(process.env.SMOKE_GEO_ID) : 2826;
const client = createGoogleClient();

try {
  const page = await client.searchCreatives({
    advertiserId,
    geoId,
    dateRange: {
      start: process.env.SMOKE_START_DATE ?? "20260516",
      end: process.env.SMOKE_END_DATE ?? "20260523"
    }
  });

  console.log(JSON.stringify({
    status: "ok",
    advertiserId,
    geoId,
    creatives: page.creatives.length,
    hasNextPage: Boolean(page.nextPageToken)
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("browser-native:challenge:")) {
    console.log(JSON.stringify({ status: "challenge", message }, null, 2));
    process.exitCode = 0;
  } else if (message.startsWith("browser-native:timeout:")) {
    console.log(JSON.stringify({ status: "timeout", message }, null, 2));
    process.exitCode = 0;
  } else if (message.startsWith("blocked:") || message.includes("403") || message.includes("429")) {
    console.log(JSON.stringify({ status: "blocked", message }, null, 2));
    process.exitCode = 0;
  } else if (message.includes("SearchService/SearchCreatives:404")) {
    console.log(JSON.stringify({
      status: "rpc_not_found",
      message,
      hint: "Google changed or hides the SearchCreatives RPC endpoint. Capture a fresh browser request before live scans."
    }, null, 2));
    process.exitCode = 0;
  } else {
    throw error;
  }
} finally {
  await client.close?.();
}
