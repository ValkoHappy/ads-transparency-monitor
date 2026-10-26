import { type Page, type Response } from "playwright";
import {
  classifyChallengeText,
  type BrowserNativePageState,
} from "../browser-native-diagnostics.js";
import { type SearchPayloadInput } from "../google-client.js";
import { isTimeoutLikeMessage } from "./runtime-policy.js";

export async function gotoAdvertiser(
  page: Page,
  advertiserId: string,
  dateRange?: SearchPayloadInput["dateRange"],
) {
  try {
    return await page.goto(advertiserUrl(advertiserId, dateRange), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTimeoutLikeMessage(message)) {
      throw new Error(`browser-native:timeout:GooglePage:${message}`);
    }
    throw error;
  }
}

export function advertiserUrl(
  advertiserId: string,
  dateRange?: SearchPayloadInput["dateRange"],
) {
  const params = new URLSearchParams({ region: "anywhere" });
  if (dateRange?.start && dateRange.end) {
    params.set("start-date", googleDateToIso(dateRange.start));
    params.set("end-date", googleDateToIso(dateRange.end));
  }
  return `https://adstransparency.google.com/advertiser/${advertiserId}?${params.toString()}`;
}

export function googleDateToIso(value: string) {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
}

export async function assertPageIsUsable(
  page: Page,
  response: Response | null,
) {
  if (!response)
    throw new Error(
      `browser-native:timeout:GooglePage:no-response:${page.url()}`,
    );
  if (/google\.[^/]+\/sorry\//i.test(page.url()))
    throw new Error(`browser-native:challenge:GooglePage:${page.url()}`);
  if ([403, 429].includes(response.status()))
    throw new Error(`blocked:GooglePage:${response.status()}:${page.url()}`);
  if (!response.ok())
    throw new Error(`blocked:GooglePage:${response.status()}:${page.url()}`);

  const state = await detectPageState(page);
  if (state === "captcha")
    throw new Error(`browser-native:challenge:GooglePage:${page.url()}`);
  if (state === "blocked")
    throw new Error(`blocked:GooglePage:content:${page.url()}`);
  if (state === "empty")
    throw new Error(`browser-native:empty:GooglePage:${page.url()}`);
}

export async function detectPageState(
  page: Page,
): Promise<BrowserNativePageState> {
  const data = await page
    .evaluate(() => {
      const bodyText = document.body?.innerText ?? "";
      const hasCaptchaFrame = [...document.querySelectorAll("iframe")].some(
        (frame) =>
          /captcha|recaptcha|challenge|sorry/i.test(
            frame.getAttribute("src") ?? "",
          ),
      );
      const hasCards = document.querySelectorAll(
        "creative-preview, material-card, a[href*='creative'], a[href*='play.google.com'], a[href*='apps.apple.com']",
      ).length;
      return { bodyText, hasCaptchaFrame, hasCards };
    })
    .catch(() => ({ bodyText: "", hasCaptchaFrame: false, hasCards: 0 }));
  if (data.hasCaptchaFrame) return "captcha";
  const textState = classifyChallengeText(data.bodyText);
  if (textState !== "normal") return textState;
  if (!data.bodyText.trim() && data.hasCards === 0) return "empty";
  return "normal";
}

export async function pageMetrics(page: Page) {
  return page
    .evaluate(() => ({
      height: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        document.body.clientHeight,
        document.documentElement.clientHeight,
      ),
      cards: document.querySelectorAll(
        "creative-preview, material-card, a[href*='/creative/'], iframe",
      ).length,
    }))
    .catch(() => ({ height: 0, cards: 0 }));
}

export async function humanScroll(page: Page, deltaY: number) {
  const scrollDriver = process.env.GOOGLE_BROWSER_SCROLL_DRIVER ?? "js";
  if (scrollDriver === "keyboard") {
    const key = deltaY < 0 ? "PageUp" : "PageDown";
    const repeats = Math.max(1, Math.min(4, Math.ceil(Math.abs(deltaY) / 620)));
    for (let index = 0; index < repeats; index += 1) {
      await page.keyboard.press(key);
      await page.waitForTimeout(20);
    }
    return;
  }

  if (process.env.GOOGLE_BROWSER_USE_MOUSE_WHEEL === "true") {
    await page.mouse
      .move(
        420 + Math.floor(Math.random() * 450),
        280 + Math.floor(Math.random() * 280),
      )
      .catch(() => undefined);
    await page.mouse.wheel(0, deltaY);
    return;
  }

  await page.evaluate((scrollDelta) => {
    window.scrollBy({ top: scrollDelta, behavior: "instant" });
    window.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: scrollDelta,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, deltaY);
}

export async function humanPause(page: Page, baseMs: number, jitterMs = 250) {
  await page.waitForTimeout(baseMs + Math.floor(Math.random() * jitterMs));
}

export async function keepNewestCardsInViewport(page: Page, attempt: number) {
  await page
    .evaluate((check) => {
      const height =
        document.documentElement.scrollHeight ||
        document.body.scrollHeight ||
        0;
      if (check > 0 && check % 20 === 0) {
        window.scrollBy({
          top: -Math.max(600, Math.floor(window.innerHeight * 0.9)),
          behavior: "instant",
        });
      } else {
        window.scrollTo({ top: height, behavior: "instant" });
      }
      window.dispatchEvent(new Event("scroll"));
    }, attempt)
    .catch(() => undefined);
}

export async function revealMissingPreviewCards(
  page: Page,
  missingCreativeIds: string[],
  attempt: number,
) {
  await page
    .evaluate(
      ({ ids, check }) => {
        const targetId = ids[check % Math.max(ids.length, 1)];
        const rootSelectors = [
          "creative-preview",
          "[class*='creative-preview']",
          ".creative-bounding-box",
          ".mys-wrapper",
          "c-wiz[data-p]",
          "material-card",
          "a[href*='/creative/']",
        ].join(",");
        const roots = [
          ...document.querySelectorAll(rootSelectors),
        ] as HTMLElement[];
        const target =
          roots.find((root) => {
            const source = `${root.textContent ?? ""} ${root.outerHTML ?? ""}`;
            return targetId
              ? source.includes(targetId)
              : ids.some((id) => source.includes(id));
          }) ??
          roots.find((root) => {
            const source = `${root.textContent ?? ""} ${root.outerHTML ?? ""}`;
            return ids.some((id) => source.includes(id));
          });
        if (target) {
          target.scrollIntoView({ block: "center", inline: "nearest" });
          window.dispatchEvent(new Event("scroll"));
          return;
        }

        if (check > 0 && check % 24 === 0) {
          window.scrollBy({
            top: -Math.max(600, Math.floor(window.innerHeight * 0.9)),
            behavior: "instant",
          });
        } else {
          window.scrollBy({
            top: Math.max(400, Math.floor(window.innerHeight * 0.75)),
            behavior: "instant",
          });
        }
        window.dispatchEvent(new Event("scroll"));
      },
      { ids: missingCreativeIds.slice(0, 10), check: attempt },
    )
    .catch(() => undefined);
}
