import { describe, expect, it } from "vitest";
import { RequestBodyTooLargeError, readJsonObject } from "./request-body";

describe("request body helpers", () => {
  it("returns parsed JSON objects", async () => {
    const request = new Request("http://127.0.0.1/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ scanMode: "FULL" })
    });

    await expect(readJsonObject(request)).resolves.toEqual({ scanMode: "FULL" });
  });

  it("treats malformed or non-object JSON as empty input", async () => {
    const nullBody = new Request("http://127.0.0.1/api/settings", { method: "PATCH", body: "null" });
    const arrayBody = new Request("http://127.0.0.1/api/settings", { method: "PATCH", body: "[]" });
    const invalidBody = new Request("http://127.0.0.1/api/settings", { method: "PATCH", body: "{" });

    await expect(readJsonObject(nullBody)).resolves.toEqual({});
    await expect(readJsonObject(arrayBody)).resolves.toEqual({});
    await expect(readJsonObject(invalidBody)).resolves.toEqual({});
  });

  it("rejects bodies above the configured byte limit", async () => {
    const request = new Request("http://127.0.0.1/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ value: "x".repeat(32) })
    });

    await expect(readJsonObject(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("rejects oversized content-length before reading the body", async () => {
    const request = new Request("http://127.0.0.1/api/settings", {
      method: "PATCH",
      headers: { "content-length": "100" },
      body: "{}"
    });

    await expect(readJsonObject(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
