import { describe, expect, it } from "vitest";
import { backoffDelayMs, isGoogleBlockedError, shouldProbeGoogle } from "./google-health";

describe("google health helpers", () => {
  it("detects blocked errors", () => {
    expect(isGoogleBlockedError(new Error("blocked:SearchService/SearchCreatives:429"))).toBe(true);
    expect(isGoogleBlockedError(new Error("rpc:SearchService/SearchCreatives:500"))).toBe(false);
  });

  it("uses progressive backoff with bounded jitter", () => {
    expect(backoffDelayMs(1, 0)).toBe(990_000);
    expect(backoffDelayMs(1, 1)).toBe(1_170_000);
    expect(backoffDelayMs(10, 0)).toBe(47_520_000);
  });

  it("probes only after cooldown and interval", () => {
    const now = new Date("2026-05-26T00:00:00.000Z");
    expect(shouldProbeGoogle({ status: "BLOCKED", blockedUntil: new Date("2026-05-26T00:01:00.000Z"), lastProbeAt: null }, 60_000, now)).toBe(false);
    expect(shouldProbeGoogle({ status: "BLOCKED", blockedUntil: new Date("2026-05-25T23:59:00.000Z"), lastProbeAt: null }, 60_000, now)).toBe(true);
    expect(shouldProbeGoogle({ status: "BLOCKED", blockedUntil: new Date("2026-05-25T23:59:00.000Z"), lastProbeAt: new Date("2026-05-25T23:59:30.000Z") }, 60_000, now)).toBe(true);
    expect(shouldProbeGoogle({ status: "OK", blockedUntil: null, lastProbeAt: null }, 60_000, now)).toBe(false);
  });
});
