import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  browserNativeProfileDir,
  cleanupStaleBrowserProfiles,
  classifyBrowserNativeError,
  classifyChallengeText,
  prepareBrowserProfileDir,
  releaseBrowserProfileDir,
  dedupeBrowserItems,
  isBrowserProfileLockError,
  shouldContinueBackgroundDetailAfterError
} from "./browser-native-diagnostics.js";

describe("browser native diagnostics", () => {
  it("classifies challenge, timeout and blocked errors for proxy health", () => {
    expect(classifyBrowserNativeError(new Error("browser-native:challenge:GooglePage:https://example.com"))).toBe("CHALLENGE_REQUIRED");
    expect(classifyBrowserNativeError(new Error("browser-native:timeout:GooglePage:Timeout 60000ms"))).toBe("TIMEOUT");
    expect(classifyBrowserNativeError(new Error("page.goto: net::ERR_TIMED_OUT at https://example.com"))).toBe("TIMEOUT");
    expect(classifyBrowserNativeError(new Error("page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://example.com"))).toBe("TIMEOUT");
    expect(classifyBrowserNativeError(new Error("browser-native:no-search-results"))).toBe("FAILED");
    expect(classifyBrowserNativeError(new Error("browser-native:profile-locked:/tmp/profile"))).toBe("PROFILE_LOCKED");
    expect(classifyBrowserNativeError(new Error("Failed to create a ProcessSingleton for your profile directory"))).toBe("PROFILE_LOCKED");
    expect(classifyBrowserNativeError(new Error("mouse.wheel: Target crashed"))).toBe("TIMEOUT");
    expect(classifyBrowserNativeError(new Error("Target page, context or browser has been closed"))).toBe("TIMEOUT");
    expect(classifyBrowserNativeError(new Error("browser-native:preview-incomplete:0/40:CR1"))).toBe("FAILED");
    expect(classifyBrowserNativeError(new Error("blocked:GooglePage:429"))).toBe("BLOCKED");
    expect(classifyBrowserNativeError(new Error("boom"))).toBe("FAILED");
  });

  it("continues a background detail slot after a creative-specific empty response", () => {
    expect(shouldContinueBackgroundDetailAfterError(new Error("creative-detail-empty:CR1"))).toBe(true);
    expect(shouldContinueBackgroundDetailAfterError(new Error("browser-native:no-search-results"))).toBe(false);
    expect(shouldContinueBackgroundDetailAfterError(new Error("mouse.wheel: Target crashed"))).toBe(false);
  });

  it("detects browser profile lock errors", () => {
    expect(isBrowserProfileLockError(new Error("browserType.launchPersistentContext: Failed to create a ProcessSingleton for your profile directory."))).toBe(true);
    expect(isBrowserProfileLockError(new Error("browser-native:profile-locked:/tmp/profile"))).toBe(true);
    expect(isBrowserProfileLockError(new Error("boom"))).toBe(false);
  });

  it("detects captcha text from Google challenge pages", () => {
    expect(classifyChallengeText("Our systems have detected unusual traffic from your computer network. reCAPTCHA")).toBe("captcha");
    expect(classifyChallengeText("Ik ben geen robot. Onze systemen hebben ongebruikelijk verkeer vastgesteld.")).toBe("captcha");
    expect(classifyChallengeText("Request blocked because too many requests")).toBe("blocked");
    expect(classifyChallengeText("Ads Transparency Center")).toBe("normal");
  });

  it("keeps worker browser profiles separated by slot while preserving proxy identity", () => {
    const first = browserNativeProfileDir("socks5://user:pass@example.com:1080", "worker-slot-1-proxy-1");
    const second = browserNativeProfileDir("socks5://user:pass@example.com:1080", "worker-slot-2-proxy-1");
    expect(first).not.toBe(second);
    expect(first).toContain("worker-slot-1-proxy-1");
    expect(second).toContain("worker-slot-2-proxy-1");
  });

  it("dedupes by creative id and fallback browser key", () => {
    const items = dedupeBrowserItems([
      { creativeId: "CR1", creativeUrl: "u1", appId: "a", store: "GOOGLE_PLAY" },
      { creativeId: "CR1", creativeUrl: "u2", appId: "b", store: "APP_STORE" },
      { creativeId: null, creativeUrl: "u3", appId: "a", store: "GOOGLE_PLAY" },
      { creativeId: null, creativeUrl: "u3", appId: "a", store: "GOOGLE_PLAY" }
    ], (item) => item);

    expect(items).toHaveLength(2);
    expect(items[0]?.creativeId).toBe("CR1");
    expect(items[1]?.creativeUrl).toBe("u3");
  });

  it("cleans stale singleton artifacts before leasing a profile directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atm-profile-"));
    const profileDir = path.join(root, "profile-a");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "SingletonLock"), "stale", "utf8");

    await prepareBrowserProfileDir(profileDir);

    await expect(open(path.join(profileDir, "SingletonLock"), "r")).rejects.toBeTruthy();
    await releaseBrowserProfileDir(profileDir);
    await rm(root, { recursive: true, force: true });
  });

  it("does not delete a live leased profile during stale cleanup", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atm-profile-base-"));
    const previous = process.env.GOOGLE_BROWSER_PROFILE_DIR;
    process.env.GOOGLE_BROWSER_PROFILE_DIR = baseDir;
    const liveProfile = path.join(baseDir, "live");
    await mkdir(liveProfile, { recursive: true });
    await writeFile(path.join(liveProfile, ".lease.json"), JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      profileDir: liveProfile
    }), "utf8");

    await cleanupStaleBrowserProfiles({ now: Date.now() + 24 * 60 * 60 * 1000, ttlMs: 1 });

    const handle = await open(path.join(liveProfile, ".lease.json"), "r");
    await handle.close();
    if (previous === undefined) {
      delete process.env.GOOGLE_BROWSER_PROFILE_DIR;
    } else {
      process.env.GOOGLE_BROWSER_PROFILE_DIR = previous;
    }
    await rm(baseDir, { recursive: true, force: true });
  });
});
