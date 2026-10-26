const FORMULA_PREFIX = /^[=+\-@\t\r\n]/;

export function sanitizeSpreadsheetCell(value: string) {
  const cleaned = value.replace(/\u0000/g, "");
  return FORMULA_PREFIX.test(cleaned.trimStart()) ? `'${cleaned}` : cleaned;
}
