import { describe, expect, it } from "vitest";
import { sanitizePublicValue } from "./sanitize";

describe("public value sanitization", () => {
  it("redacts sensitive object keys recursively", () => {
    expect(sanitizePublicValue({
      headers: {
        authorization: "Bearer secret",
        Cookie: "sid=secret",
        "set-cookie": ["sid=secret"]
      },
      nested: {
        access_token: "secret",
        proxyPassword: "secret"
      },
      url: "https://user:pass@example.com/path"
    })).toEqual({
      headers: {
        authorization: "[redacted]",
        Cookie: "[redacted]",
        "set-cookie": "[redacted]"
      },
      nested: {
        access_token: "[redacted]",
        proxyPassword: "[redacted]"
      },
      url: "https://***:***@example.com/path"
    });
  });
});
