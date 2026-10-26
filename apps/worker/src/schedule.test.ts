import { describe, expect, it } from "vitest";
import { resolveDueAdvertiserScanPlan, resumeCountryCodes } from "./schedule";

const settings = {
  defaultCountries: ["GB", "DE"],
  scanMode: "FULL" as const,
  requestDelayMs: 1000,
  maxPagesPerRun: 5,
  maxCreativesPerRun: 100
};

describe("worker schedule planning", () => {
  it("uses advertiser selected countries before global defaults", () => {
    const plan = resolveDueAdvertiserScanPlan({
      selectedCountries: ["FR"],
      scanMode: "CAUTIOUS",
      requestDelayMs: null,
      maxPagesPerRun: null,
      maxCreativesPerRun: null
    }, settings);

    expect(plan.countries).toEqual(["FR"]);
    expect(plan.options.scanMode).toBe("CAUTIOUS");
    expect(plan.options.maxPagesPerRun).toBe(5);
  });

  it("falls back to default countries and keeps configured full scan limits", () => {
    const plan = resolveDueAdvertiserScanPlan({
      selectedCountries: [],
      scanMode: null,
      requestDelayMs: 2500,
      maxPagesPerRun: 2,
      maxCreativesPerRun: 40,
      scanStartDate: "2026-05-01",
      scanEndDate: "2026-05-28"
    }, settings);

    expect(plan.countries).toEqual(["GB", "DE"]);
    expect(plan.options).toMatchObject({
      scanMode: "FULL",
      requestDelayMs: 2500,
      scanStartDate: "2026-05-01",
      scanEndDate: "2026-05-28"
    });
    expect(plan.options.maxPagesPerRun).toBe(2);
    expect(plan.options.maxCreativesPerRun).toBe(40);
  });

  it("resumes chunked country scans from the saved country", () => {
    expect(resumeCountryCodes(["GB", "DE", "FR"], "DE")).toEqual(["DE", "FR"]);
    expect(resumeCountryCodes(["GB", "DE"], null)).toEqual(["GB", "DE"]);
    expect(resumeCountryCodes(["GB", "DE"], "IT")).toEqual(["GB", "DE"]);
  });
});
