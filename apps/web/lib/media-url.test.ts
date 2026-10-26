import { describe, expect, it } from "vitest";
import { isPreviewMediaAsset, safeExternalHttpUrl } from "./media-url";

describe("media-url", () => {
  it("allows only http and https external URLs", () => {
    expect(safeExternalHttpUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(safeExternalHttpUrl("http://example.com/a.png")).toBe("http://example.com/a.png");
    expect(safeExternalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalHttpUrl("data:image/png;base64,aaa")).toBeNull();
    expect(safeExternalHttpUrl("/relative.png")).toBeNull();
  });

  it("keeps landing URLs out of preview media", () => {
    expect(isPreviewMediaAsset({ kind: "LANDSCAPE_IMAGE", url: "https://example.com/a.png" })).toBe(true);
    expect(isPreviewMediaAsset({ kind: "VIDEO", url: "https://example.com/a.mp4" })).toBe(true);
    expect(isPreviewMediaAsset({ kind: "LANDING_URL", url: "https://example.com" })).toBe(false);
    expect(isPreviewMediaAsset({ kind: "VIDEO", url: "javascript:alert(1)" })).toBe(false);
  });

  it("keeps Google preview scripts out of preview media", () => {
    expect(
      isPreviewMediaAsset({
        kind: "LANDSCAPE_IMAGE",
        url: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1"
      })
    ).toBe(false);
  });
});
