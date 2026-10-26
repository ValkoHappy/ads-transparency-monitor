const APP_TIME_ZONE = "Europe/Moscow";
const MOSCOW_UTC_OFFSET_HOURS = 3;

const statusLabels: Record<string, string> = {
  SUCCESS: "Успешно",
  ACTIVE: "Активен",
  FAILED: "Ошибка",
  STOPPED: "Остановлен",
  BLOCKED: "Ограничено",
  CANCELED: "Отменено",
  QUEUED: "В очереди",
  RUNNING: "В процессе",
  UNKNOWN: "Неизвестно"
};

const storeLabels: Record<string, string> = {
  GOOGLE_PLAY: "Google Play",
  APP_STORE: "App Store",
  UNKNOWN: "Неизвестно"
};

const formatLabels: Record<string, string> = {
  VIDEO: "Видео",
  IMAGE: "Изображение",
  TEXT: "Текст",
  UNKNOWN: "Неизвестно"
};

const assetKindLabels: Record<string, string> = {
  LANDSCAPE_IMAGE: "Изображение",
  APP_ICON: "Иконка",
  SCREENSHOT: "Скриншот",
  COVER_IMAGE: "Обложка",
  VIDEO: "Видео",
  LANDING_URL: "Ссылка"
};

export function formatStatusLabel(status?: string | null) {
  return statusLabels[status ?? "UNKNOWN"] ?? "Неизвестно";
}

export function formatStoreLabel(store?: string | null) {
  return storeLabels[store ?? "UNKNOWN"] ?? store ?? "Неизвестно";
}

export function formatCreativeFormat(format?: string | null) {
  return formatLabels[format ?? "UNKNOWN"] ?? "Неизвестно";
}

export function formatAssetKind(kind?: string | null) {
  return assetKindLabels[kind ?? "UNKNOWN"] ?? "Материал";
}

export function formatCountries(countries?: string[] | null) {
  const value = countries?.filter(Boolean).join(", ");
  return value || "Все страны";
}

export function formatScanMode(mode?: string | null) {
  return (
    {
      FAST: "Быстрый",
      FULL: "Полный",
      CAUTIOUS: "Осторожный"
    } as Record<string, string>
  )[mode ?? ""] ?? "Осторожный";
}

export function formatDateTime(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ru-RU", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatDate(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("ru-RU", { timeZone: APP_TIME_ZONE });
}

export function nextDailyScanTime(from = new Date(), hour = 3) {
  return nextDailyMoscowScanTime(from, hour);
}

export type ScheduleSettings = {
  dailyScanHour?: number | null;
  scheduleType?: string | null;
  dailyScanHours?: number[] | null;
  scanIntervalHours?: number | null;
};

export function nextScheduledScanTime(from = new Date(), settings: ScheduleSettings = {}) {
  const scheduleType = settings.scheduleType ?? "DAILY";
  if (scheduleType === "INTERVAL") {
    const interval = clampInterval(settings.scanIntervalHours);
    const now = from instanceof Date ? from : new Date(from);
    const parts = getMoscowParts(now);
    const nextHour = Math.floor(parts.hour / interval) * interval + interval;
    const targetDay = nextHour >= 24 ? addMoscowDays(parts, 1) : parts;
    return moscowWallTimeToUtcDate(targetDay.year, targetDay.month, targetDay.day, nextHour % 24);
  }

  const hours = normalizeScheduleHours(settings);
  const now = from instanceof Date ? from : new Date(from);
  const today = getMoscowParts(now);
  for (const hour of hours) {
    const next = moscowWallTimeToUtcDate(today.year, today.month, today.day, hour);
    if (next > now) return next;
  }
  const tomorrow = addMoscowDays(today, 1);
  return moscowWallTimeToUtcDate(tomorrow.year, tomorrow.month, tomorrow.day, hours[0] ?? 3);
}

export function formatSchedule(settings: ScheduleSettings = {}) {
  if ((settings.scheduleType ?? "DAILY") === "INTERVAL") {
    return `каждые ${clampInterval(settings.scanIntervalHours)} ч.`;
  }
  const hours = normalizeScheduleHours(settings).map((hour) => `${String(hour).padStart(2, "0")}:00`);
  return hours.length > 1 ? `в ${hours.join(", ")}` : `ежедневно в ${hours[0] ?? "03:00"}`;
}

export function formatScheduleHours(settings: ScheduleSettings = {}) {
  return normalizeScheduleHours(settings).join(", ");
}

function normalizeScheduleHours(settings: ScheduleSettings) {
  const source = settings.dailyScanHours?.length ? settings.dailyScanHours : [settings.dailyScanHour ?? 3];
  const hours = [...new Set(source.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23))];
  return hours.length ? hours.sort((a, b) => a - b) : [3];
}

function clampInterval(value?: number | null) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return 24;
  return Math.min(24, Math.max(1, Math.round(interval)));
}

function nextDailyMoscowScanTime(from: Date | string = new Date(), hour = 3) {
  const now = from instanceof Date ? from : new Date(from);
  const today = getMoscowParts(now);
  let next = moscowWallTimeToUtcDate(today.year, today.month, today.day, hour);
  if (next <= now) {
    const tomorrow = addMoscowDays(today, 1);
    next = moscowWallTimeToUtcDate(tomorrow.year, tomorrow.month, tomorrow.day, hour);
  }
  return next;
}

function getMoscowParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function addMoscowDays(parts: { year: number; month: number; day: number }, days: number) {
  const utcNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12 - MOSCOW_UTC_OFFSET_HOURS));
  return getMoscowParts(utcNoon);
}

function moscowWallTimeToUtcDate(year: number, month: number, day: number, hour: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - MOSCOW_UTC_OFFSET_HOURS, 0, 0, 0));
}

export function transparencyAdvertiserUrl(advertiserId?: string | null, dateRange?: { startDate?: string | null; endDate?: string | null }) {
  if (!advertiserId) return undefined;
  const params = new URLSearchParams();
  if (dateRange?.startDate && dateRange.endDate) {
    params.set("region", "anywhere");
    params.set("start-date", dateRange.startDate);
    params.set("end-date", dateRange.endDate);
  }
  const query = params.toString();
  return `https://adstransparency.google.com/advertiser/${encodeURIComponent(advertiserId)}${query ? `?${query}` : ""}`;
}

export function transparencyCreativeUrl(advertiserId?: string | null, creativeId?: string | null) {
  if (!advertiserId || !creativeId) return undefined;
  return `https://adstransparency.google.com/advertiser/${encodeURIComponent(advertiserId)}/creative/${encodeURIComponent(creativeId)}`;
}

export function formatScanMessage(message?: string | null) {
  if (!message) return "-";
  const clean = message
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\[\d+m/g, "")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1***:***@")
    .replace(/\b((?:\d{1,3}\.){3}\d{1,3}:\d{2,5}):([^:\s]+):([^\s]+)/g, "$1:***:***")
    .replace(/^((?:set-cookie|cookie|authorization|proxy-authorization|x-client-data)\s*:\s*).+$/gim, "$1[redacted]")
    .replace(/\b((?:access_token|refresh_token|id_token|api_key|password|passwd|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s*Call log:[\s\S]*$/m, "")
    .replace(/\s+/g, " ")
    .trim();

  const friendly = friendlyScanMessage(clean);
  const result = friendly ?? clean;
  return result.length > 180 ? `${result.slice(0, 180)}...` : result;
}

function friendlyScanMessage(message: string) {
  if (message.startsWith("browser-native:profile-locked:") || message.includes("ProcessSingleton") || message.includes("SingletonLock")) {
    return "Браузерный профиль был занят другим процессом. Воркер не смог безопасно открыть Chromium.";
  }
  if (message === "browser-native:empty-search-page" || message === "browser-native:no-search-results") {
    return "Страница рекламодателя открылась, но креативы не удалось собрать даже после повторной попытки.";
  }
  if (message.includes("DETAIL_RPC_INCOMPLETE")) {
    return "Detail RPC не дозаполнен для креативов. Сбор остановлен, чтобы не считать данные полными.";
  }
  if (message.includes("PREVIEW_INCOMPLETE")) {
    return "Preview карточки не догрузились полностью. Сбор остановлен, чтобы не пропустить данные.";
  }
  if (message.includes("ERR_PROXY_CONNECTION_FAILED")) {
    return "Прокси не подключился. Отключите прокси или укажите рабочий URL.";
  }
  if (message.startsWith("browser-native:challenge:")) {
    return "Нужна ручная проверка proxy: Google показал captcha или challenge.";
  }
  if (message.startsWith("browser-native:timeout:")) {
    return "Proxy не открыл страницу Google вовремя.";
  }
  if (message.includes("no healthy proxy")) {
    return "Нет рабочего proxy для браузерного сбора. Проверьте proxy pool или временно отключите прокси.";
  }
  if (message.includes("SearchService/SearchCreatives:404")) {
    return "Google вернул 404 на RPC-поиск. Нужен браузерный режим или пауза.";
  }
  if (message.startsWith("blocked:") || message.includes(":403") || message.includes(":429") || message.includes("captcha")) {
    return "Google ограничил запрос. Нужна пауза, probe позже или рабочий прокси.";
  }
  if (message === "scan-canceled") {
    return "Сканирование остановлено пользователем.";
  }
  return null;
}
