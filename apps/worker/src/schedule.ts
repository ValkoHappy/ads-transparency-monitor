type ScanMode = "FAST" | "FULL" | "CAUTIOUS";

export function resolveDueAdvertiserScanPlan(
  advertiser: {
    selectedCountries: string[];
    scanMode?: ScanMode | null;
    requestDelayMs?: number | null;
    maxPagesPerRun?: number | null;
    maxCreativesPerRun?: number | null;
    scanStartDate?: string | null;
    scanEndDate?: string | null;
  },
  settings: {
    defaultCountries: string[];
    scanMode: ScanMode;
    requestDelayMs: number;
    maxPagesPerRun?: number | null;
    maxCreativesPerRun?: number | null;
  }
) {
  const scanMode = advertiser.scanMode ?? settings.scanMode;
  return {
    countries: advertiser.selectedCountries.length ? advertiser.selectedCountries : settings.defaultCountries,
    options: {
      scanMode,
      requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
      maxPagesPerRun: advertiser.maxPagesPerRun ?? settings.maxPagesPerRun ?? undefined,
      maxCreativesPerRun: advertiser.maxCreativesPerRun ?? settings.maxCreativesPerRun ?? undefined,
      scanStartDate: advertiser.scanStartDate,
      scanEndDate: advertiser.scanEndDate
    }
  };
}

export function resumeCountryCodes(countries: string[], currentCountryCode?: string | null) {
  if (!currentCountryCode) return countries;
  const index = countries.indexOf(currentCountryCode);
  return index >= 0 ? countries.slice(index) : countries;
}
