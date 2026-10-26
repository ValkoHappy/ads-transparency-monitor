import { describe, expect, it } from "vitest";
import { sanitizeSpreadsheetCell } from "./spreadsheet";

describe("spreadsheet export safety", () => {
  it("neutralizes formula-like text cells", () => {
    expect(sanitizeSpreadsheetCell("=cmd|calc")).toBe("'=cmd|calc");
    expect(sanitizeSpreadsheetCell(" +SUM(1,1)")).toBe("' +SUM(1,1)");
    expect(sanitizeSpreadsheetCell("@HYPERLINK(\"http://x\")")).toBe("'@HYPERLINK(\"http://x\")");
    expect(sanitizeSpreadsheetCell("normal text")).toBe("normal text");
  });
});
