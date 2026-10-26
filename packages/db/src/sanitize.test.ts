import { describe, expect, it } from "vitest";
import { sanitizeOperationalMessage } from "./sanitize";

describe("sanitizeOperationalMessage", () => {
  it("masks credentials in proxy URLs and compact proxy values", () => {
    expect(sanitizeOperationalMessage("failed socks5://user:pass@example.com:1080")).toBe("failed socks5://***:***@example.com:1080");
    expect(sanitizeOperationalMessage("proxy 198.51.100.10:8000:user:pa:ss failed")).toBe("proxy 198.51.100.10:8000:***:*** failed");
    expect(sanitizeOperationalMessage("db postgresql://ads:secret@postgres:5432/ads_monitor failed")).toBe("db postgresql://***:***@postgres:5432/ads_monitor failed");
  });

  it("redacts sensitive header lines and query/form parameters", () => {
    expect(sanitizeOperationalMessage("authorization: Bearer abc\nok")).toBe("authorization: [redacted]\nok");
    expect(sanitizeOperationalMessage("url https://example.com/cb?access_token=abc&x=1 password=hunter2")).toBe("url https://example.com/cb?access_token=[redacted]&x=1 password=[redacted]");
  });
});
