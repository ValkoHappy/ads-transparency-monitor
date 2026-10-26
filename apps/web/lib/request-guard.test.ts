import { describe, expect, it } from "vitest";
import { isSameOriginMutation, rejectCrossOriginMutation } from "./request-guard";

describe("request mutation guard", () => {
  it("allows requests without origin", () => {
    const request = new Request("http://127.0.0.1:3100/api/settings");

    expect(rejectCrossOriginMutation(request)).toBeNull();
  });

  it("allows same-origin requests", () => {
    const request = new Request("http://127.0.0.1:3100/api/settings", {
      headers: { origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }
    });

    expect(rejectCrossOriginMutation(request)).toBeNull();
  });

  it("honors forwarded host and protocol behind a proxy", () => {
    const request = new Request("http://web:3000/api/settings", {
      headers: {
        origin: "https://ads.example.com",
        host: "web:3000",
        "x-forwarded-host": "ads.example.com",
        "x-forwarded-proto": "https"
      }
    });

    expect(rejectCrossOriginMutation(request)).toBeNull();
  });

  it("handles IPv6 localhost proxy hosts", () => {
    const request = new Request("http://[::1]:3000/api/settings", {
      headers: {
        origin: "https://ads.example.com",
        host: "[::1]:3000",
        "x-forwarded-host": "ads.example.com",
        "x-forwarded-proto": "https"
      }
    });

    expect(rejectCrossOriginMutation(request)).toBeNull();
  });

  it("does not trust spoofed forwarded host on public direct requests", () => {
    const request = new Request("http://198.51.100.10:3100/api/settings", {
      headers: {
        origin: "https://evil.example",
        host: "198.51.100.10:3100",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https"
      }
    });

    expect(rejectCrossOriginMutation(request)?.status).toBe(403);
  });

  it("rejects cross-origin mutations", () => {
    const request = new Request("http://127.0.0.1:3100/api/settings", {
      headers: { origin: "https://evil.example", host: "127.0.0.1:3100" }
    });

    expect(rejectCrossOriginMutation(request)?.status).toBe(403);
  });

  it("checks same-origin server action headers without a request URL", () => {
    expect(isSameOriginMutation(new Headers({
      origin: "http://127.0.0.1:3100",
      host: "127.0.0.1:3100"
    }))).toBe(true);

    expect(isSameOriginMutation(new Headers({
      origin: "https://evil.example",
      host: "127.0.0.1:3100"
    }))).toBe(false);
  });
});
