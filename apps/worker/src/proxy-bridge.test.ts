import { describe, expect, it } from "vitest";
import { normalizeRuntimeProxyUrl, resolvePlaywrightProxy } from "./proxy-bridge.js";

describe("proxy bridge", () => {
  it("normalizes compact proxy format for worker env values", () => {
    expect(normalizeRuntimeProxyUrl("198.51.100.10:8000:user:pass")).toBe("socks5://user:pass@198.51.100.10:8000");
    expect(normalizeRuntimeProxyUrl("socks5://198.51.100.10:8000:user:pass")).toBe("socks5://user:pass@198.51.100.10:8000");
    expect(normalizeRuntimeProxyUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("passes HTTP proxy credentials directly to Playwright", async () => {
    await expect(resolvePlaywrightProxy("http://user:pass@127.0.0.1:8080")).resolves.toEqual({
      server: "http://127.0.0.1:8080",
      username: "user",
      password: "pass"
    });
  });

  it("creates a local HTTP bridge for authenticated SOCKS5 proxies", async () => {
    const proxy = await resolvePlaywrightProxy("socks5://user:pass@127.0.0.1:65000");
    expect(proxy.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(proxy.username).toBeUndefined();
    expect(proxy.password).toBeUndefined();
  });

  it("supports socks5h authenticated proxies through the same bridge", async () => {
    const proxy = await resolvePlaywrightProxy("socks5h://user:pass@127.0.0.1:65001");
    expect(proxy.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("accepts compact SOCKS5 values directly", async () => {
    const proxy = await resolvePlaywrightProxy("127.0.0.1:65002:user:pass");
    expect(proxy.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
