import { expect, test } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Почта").fill("admin@ads-monitor.local");
  await page.getByPlaceholder("Пароль").fill("TestOnly!ChangeInCi2026");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

test("private dashboard flow works on desktop", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Дашборд" })).toBeVisible();
  await expect(page.locator(".stat-card")).toHaveCount(6);

  await page.getByRole("link", { name: /Рекламодатели/ }).click();
  await expect(page.getByRole("heading", { name: "Рекламодатели" })).toBeVisible();
  await page.evaluate(async () => {
    await fetch("/api/advertisers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "AR00000000000000000001",
        name: "E2E Advertiser",
        selectedCountries: ["GB", "BE"]
      })
    });
  });
  await page.reload();
  await expect(page.getByText("E2E Advertiser")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("row", { name: /E2E Advertiser/ }).getByRole("button", { name: /Проверить/ }).click();
  await page.getByRole("link", { name: /Сканирования/ }).click();
  await expect(page.getByRole("heading", { name: "Сканирования" })).toBeVisible();
  await expect(page.getByText("В очереди").first()).toBeVisible();

  await page.getByRole("link", { name: /Креативы/ }).click();
  await expect(page.getByRole("heading", { name: "Креативы" })).toBeVisible();
  await page.getByPlaceholder("Креатив или приложение").fill("CR063");
  await expect(page.getByRole("link", { name: "CR06346342443637538817" })).toBeVisible();
  await page.getByRole("link", { name: "CR06346342443637538817" }).click();
  await expect(page.getByRole("heading", { name: "CR06346342443637538817" })).toBeVisible();
  await expect(page.getByText("География")).toBeVisible();
  await expect(page.getByText("Данные источника")).toBeVisible();

  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/creatives.csv");
    return { ok: response.ok, text: await response.text() };
  });
  expect(csv.ok).toBe(true);
  expect(csv.text).toContain("creative_id");
});

test("API routes require auth and work with seeded data", async ({ page, request }) => {
  const unauthorized = await request.get("/api/dashboard/stats");
  expect(unauthorized.status()).toBe(401);

  await login(page);

  const stats = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard/stats");
    return { ok: response.ok, body: await response.json() };
  });
  expect(stats.ok).toBe(true);
  expect(stats.body).toMatchObject({ advertisers: expect.any(Number), creatives: expect.any(Number) });

  const advertiserPost = await page.evaluate(async () => {
    const response = await fetch("/api/advertisers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "AR00000000000000000002",
        name: "API Advertiser",
        selectedCountries: ["GB"]
      })
    });
    return { status: response.status, body: await response.json() };
  });
  expect(advertiserPost.status).toBe(201);
  const advertiser = advertiserPost.body.advertiser;

  const scanPost = await page.evaluate(async ({ advertiserId }) => {
    const response = await fetch(`/api/advertisers/${advertiserId}/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ countries: ["GB"] })
    });
    return { status: response.status, body: await response.json() };
  }, { advertiserId: advertiser.id });
  expect(scanPost.status).toBe(201);
  const queuedJob = scanPost.body.job;

  const retryPost = await page.evaluate(async ({ scanJobId }) => {
    const response = await fetch(`/api/scans/${scanJobId}/retry`, { method: "POST" });
    return response.status;
  }, { scanJobId: queuedJob.id });
  expect(retryPost).toBe(201);

  const cancelPost = await page.evaluate(async ({ scanJobId }) => {
    const response = await fetch(`/api/scans/${scanJobId}/cancel`, { method: "POST" });
    return response.ok;
  }, { scanJobId: queuedJob.id });
  expect(cancelPost).toBe(true);

  const settingsPatch = await page.evaluate(async () => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultCountries: ["GB", "DE"],
        scanMode: "FULL",
        requestDelayMs: 1200,
        maxPagesPerRun: 9,
        maxCreativesPerRun: 150,
        exportDefaultFields: ["creativeId", "advertiserName", "status"]
      })
    });
    return { ok: response.ok, body: await response.json() };
  });
  expect(settingsPatch.ok).toBe(true);
  expect(settingsPatch.body.settings.scanMode).toBe("FULL");

  for (const path of [
    "/api/advertisers",
    "/api/creatives?q=CR063&country=GB&status=ACTIVE",
    "/api/creatives/CR06346342443637538817",
    "/api/apps",
    "/api/scans",
    "/api/settings",
    "/api/export/raw.json",
    "/api/system/status"
  ]) {
    const ok = await page.evaluate(async (url) => (await fetch(url)).ok, path);
    expect(ok, path).toBe(true);
  }

  const filteredCsv = await page.evaluate(async ({ advertiserId }) => {
    const response = await fetch(`/api/export/creatives.csv?advertiserId=${advertiserId}`);
    return { ok: response.ok, text: await response.text() };
  }, { advertiserId: advertiser.id });
  expect(filteredCsv.ok).toBe(true);
  expect(filteredCsv.text).toContain("creative_id");
});

test("export builder and settings screens expose working product controls", async ({ page }) => {
  await login(page);

  await page.goto("/export?creativeIds=CR06346342443637538817&fields=creativeId,status");
  await expect(page.getByRole("heading", { name: "Экспорт" })).toBeVisible();
  await expect(page.getByText(/Будет выгружено\s+1/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Скачать CSV/ })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.getByText("Автосохранение включено")).toBeVisible();
  await page.getByLabel("Пауза, мс").fill("900");
  await expect(page.locator('input[name="requestDelayMs"]')).toHaveValue("900");
});

test("full scan from advertiser card shows visible progress and activity", async ({ page }) => {
  await login(page);
  await page.goto("/advertisers/AR14577439029227159553");
  await page.getByRole("button", { name: "Полный сбор" }).click();

  await expect(page.getByRole("heading", { name: "Состояние сбора" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Прогресс сбора" })).toBeVisible();
  await expect(page.getByText(/Live-обновление|сбор поставлен|Сбор выполняется|Задача создана/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Открыть журнал" })).toBeVisible();
});

test("mobile detail page has no document-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/creatives/CR06346342443637538817");
  await expect(page.getByRole("heading", { name: "CR06346342443637538817" })).toBeVisible();

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(hasOverflow).toBe(false);
});
