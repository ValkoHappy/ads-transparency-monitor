const MAX_COUNTRY_CODES = 300;

export function normalizeCountryCodes(input: unknown) {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,\s]+/)
      : [];

  const seen = new Set<string>();
  const countries: string[] = [];
  for (const value of values) {
    const code = String(value).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    countries.push(code);
    if (countries.length >= MAX_COUNTRY_CODES) break;
  }
  return countries;
}
