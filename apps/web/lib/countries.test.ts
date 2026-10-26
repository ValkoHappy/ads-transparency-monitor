import { describe, expect, it } from "vitest";
import { normalizeCountryCodes } from "./countries";

describe("normalizeCountryCodes", () => {
  it("normalizes, deduplicates and filters country codes", () => {
    expect(normalizeCountryCodes("gb, de xx1 ru GB")).toEqual(["GB", "DE", "RU"]);
    expect(normalizeCountryCodes(["fr", "FR", "usa", "", "it"])).toEqual(["FR", "IT"]);
  });

  it("caps country lists", () => {
    const input = Array.from({ length: 400 }, (_, index) => String.fromCharCode(65 + Math.floor(index / 26) % 26) + String.fromCharCode(65 + index % 26));

    expect(normalizeCountryCodes(input)).toHaveLength(300);
  });
});
