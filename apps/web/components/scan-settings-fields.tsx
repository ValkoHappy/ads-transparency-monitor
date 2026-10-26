"use client";

type ScanMode = "FAST" | "FULL" | "CAUTIOUS";

const PRESETS: Record<ScanMode, {
  label: string;
  hint: string;
  requestDelayMs: number;
  maxPagesPerRun: number | null;
  maxCreativesPerRun: number | null;
  workerConcurrency: number;
}> = {
  FAST: {
    label: "Быстрый",
    hint: "Проверка малого объема: 1 страница, до 20 креативов.",
    requestDelayMs: 1500,
    maxPagesPerRun: 1,
    maxCreativesPerRun: 20,
    workerConcurrency: 1
  },
  FULL: {
    label: "Полный",
    hint: "Собирает всю доступную выдачу без лимита страниц и креативов. Worker делает это кусками и продолжает с прогресса.",
    requestDelayMs: 8000,
    maxPagesPerRun: 100,
    maxCreativesPerRun: null,
    workerConcurrency: 1
  },
  CAUTIOUS: {
    label: "Осторожный",
    hint: "После блоков Google: меньше объем и длиннее пауза.",
    requestDelayMs: 45000,
    maxPagesPerRun: 1,
    maxCreativesPerRun: 10,
    workerConcurrency: 1
  }
};

export function ScanSettingsFields({
  scanMode,
  scheduleType,
  requestDelayMs,
  workerConcurrency,
  scanIntervalHours,
  dailyScanHours,
  maxPagesPerRun,
  maxCreativesPerRun,
  scheduleSummary
}: {
  scanMode: ScanMode;
  scheduleType: string;
  requestDelayMs: number;
  workerConcurrency: number;
  scanIntervalHours: number;
  dailyScanHours: string;
  maxPagesPerRun: number | null;
  maxCreativesPerRun: number | null;
  scheduleSummary: string;
}) {
  function applyPreset(mode: ScanMode, form: HTMLFormElement | null) {
    const preset = PRESETS[mode];
    if (!form) return;
    setInput(form, "scanMode", mode);
    setInput(form, "requestDelayMs", preset.requestDelayMs);
    setInput(form, "maxPagesPerRun", preset.maxPagesPerRun ?? "");
    setInput(form, "maxCreativesPerRun", preset.maxCreativesPerRun ?? "");
    setInput(form, "workerConcurrency", preset.workerConcurrency);
    form.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <div className="form-grid">
      <label className="field-label">Режим сбора
        <select
          className="select"
          name="scanMode"
          defaultValue={scanMode}
          onChange={(event) => applyPreset(event.currentTarget.value as ScanMode, event.currentTarget.form)}
        >
          {Object.entries(PRESETS).map(([value, preset]) => (
            <option value={value} key={value}>{preset.label}</option>
          ))}
        </select>
      </label>

      <div className="scan-preset-grid">
        {(Object.entries(PRESETS) as Array<[ScanMode, typeof PRESETS[ScanMode]]>).map(([mode, preset]) => (
          <button
            className="preset-button"
            type="button"
            key={mode}
            onClick={(event) => applyPreset(mode, event.currentTarget.form)}
          >
            <strong>{preset.label}</strong>
            <span>{preset.requestDelayMs} мс · {limitLabel(preset.maxPagesPerRun, "стр.")} · {limitLabel(preset.maxCreativesPerRun, "кр.")}</span>
          </button>
        ))}
      </div>

      <div className="inline-fields">
        <label className="field-label">Расписание
          <select className="select" name="scheduleType" defaultValue={scheduleType}>
            <option value="DAILY">Один раз в день</option>
            <option value="MULTIPLE">Несколько раз в день</option>
            <option value="INTERVAL">Каждые N часов</option>
          </select>
        </label>
        <label className="field-label">Пауза, мс<input className="input" name="requestDelayMs" type="number" min="500" defaultValue={requestDelayMs} /></label>
      </div>

      <div className="inline-fields three">
        <label className="field-label">Страниц за запуск<input className="input" name="maxPagesPerRun" type="number" min="1" max="1000" placeholder="без лимита" defaultValue={maxPagesPerRun ?? PRESETS[scanMode].maxPagesPerRun ?? ""} /></label>
        <label className="field-label">Креативов за запуск<input className="input" name="maxCreativesPerRun" type="number" min="1" max="100000" placeholder="без лимита" defaultValue={maxCreativesPerRun ?? PRESETS[scanMode].maxCreativesPerRun ?? ""} /></label>
        <label className="field-label">Потоки worker<input className="input" name="workerConcurrency" type="number" min="1" max="6" defaultValue={workerConcurrency} /></label>
      </div>

      <div className="inline-fields">
        <label className="field-label">Интервал, ч<input className="input" name="scanIntervalHours" type="number" min="1" max="24" defaultValue={scanIntervalHours} /></label>
        <label className="field-label">Часы запуска<input className="input" name="dailyScanHours" placeholder="3, 9, 15, 21" defaultValue={dailyScanHours} /></label>
      </div>

      <div className="muted compact-note">{PRESETS[scanMode].hint}</div>
      <div className="muted compact-note">{scheduleSummary}</div>
    </div>
  );
}

function setInput(form: HTMLFormElement | null, name: string, value: string | number) {
  const input = form?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  if (input) input.value = String(value);
}

function limitLabel(value: number | null, unit: string) {
  return value === null ? `без лимита ${unit}` : `${value} ${unit}`;
}
