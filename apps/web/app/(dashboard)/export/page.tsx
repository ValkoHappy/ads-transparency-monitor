import { EXPORT_FIELDS, type ExportField } from "@ad-monitor/db";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { Icons } from "@/components/icons";
import { PageHeader } from "@/components/shell";
import { getExportData } from "@/lib/data";

type SearchParams = Record<string, string | string[] | undefined>;
type ExportRow = Awaited<ReturnType<typeof getExportData>>["previewRows"][number];

export default async function ExportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const data = await getExportData(params);
  const query = buildQuery(params);
  const creativeIds = paramText(params.creativeIds);
  const fields = selectedFields(params.fields, data.settings.exportDefaultFields as ExportField[]);

  return (
    <div className="export-screen">
      <PageHeader title="Экспорт" subtitle="Конструктор выгрузки по рекламодателю, фильтрам или выбранным креативам" />

      <section className="grid stats-grid export-stats">
        <Stat label="Рекламодатели" value={data.stats.advertisers} />
        <Stat label="Креативы всего" value={data.stats.creatives} />
        <Stat label="По текущему фильтру" value={data.previewCount} />
        <Stat label="Сырые снимки" value={data.stats.rawSnapshots} />
      </section>

      <AutoFilterForm className="panel export-builder">
        <div className="panel-header export-builder-header">
          <div>
            <h2 className="panel-title">Параметры выгрузки</h2>
            <div className="muted chart-subtitle">
              Таблица и ссылки обновляются автоматически после изменения фильтров.
            </div>
          </div>
          <div className="toolbar export-toolbar">
            <a className="button primary" href={`/api/export/creatives.csv${query ? `?${query}` : ""}`} download>
              <Icons.Download size={16} />Скачать CSV
            </a>
            <a className="button" href={`/api/export/creatives.xlsx${query ? `?${query}` : ""}`} download>
              <Icons.FileText size={16} />Скачать Excel
            </a>
            <a className="button" href={`/api/export/raw.json${query ? `?${query}` : ""}`} download>
              <Icons.FileText size={16} />Скачать JSON
            </a>
          </div>
        </div>

        <div className="filter-grid export-filter-grid">
          <label className="field-label">Источник
            <select className="select" name="source" defaultValue={creativeIds ? "selected" : params.advertiserId ? "advertiser" : "all"}>
              <option value="all">Все данные</option>
              <option value="advertiser">Один рекламодатель</option>
              <option value="selected">Выбранные креативы</option>
              <option value="filter">Текущий фильтр</option>
            </select>
          </label>
          <label className="field-label">Рекламодатель
            <select className="select" name="advertiserId" defaultValue={paramText(params.advertiserId)}>
              <option value="">Все рекламодатели</option>
              {data.advertisers.map((advertiser) => (
                <option key={advertiser.id} value={advertiser.id}>{advertiser.name ?? advertiser.googleAdvertiserId}</option>
              ))}
            </select>
          </label>
          <label className="field-label">Страна<input className="input" name="country" placeholder="GB" defaultValue={paramText(params.country)} /></label>
          <label className="field-label">Статус
            <select className="select" name="status" defaultValue={paramText(params.status) || "ALL"}>
              <option value="ALL">Все статусы</option>
              <option value="ACTIVE">Активные</option>
              <option value="STOPPED">Остановленные</option>
              <option value="UNKNOWN">Неизвестно</option>
            </select>
          </label>
          <label className="field-label">Формат
            <select className="select" name="format" defaultValue={paramText(params.format) || "ALL"}>
              <option value="ALL">Все форматы</option>
              <option value="VIDEO">Видео</option>
              <option value="IMAGE">Изображение</option>
              <option value="TEXT">Текст</option>
              <option value="UNKNOWN">Неизвестно</option>
            </select>
          </label>
          <label className="field-label">Магазин
            <select className="select" name="store" defaultValue={paramText(params.store) || "ALL"}>
              <option value="ALL">Все магазины</option>
              <option value="GOOGLE_PLAY">Google Play</option>
              <option value="APP_STORE">App Store</option>
              <option value="UNKNOWN">Неизвестно</option>
            </select>
          </label>
          <label className="field-label">Приложение<input className="input" name="appId" placeholder="ID или название" defaultValue={paramText(params.appId)} /></label>
          <label className="field-label">Дата
            <select className="select" name="dateField" defaultValue={paramText(params.dateField) || "updatedAt"}>
              <option value="firstShownAt">Первый показ</option>
              <option value="lastShownAt">Последний показ</option>
              <option value="firstFoundAt">Первый сбор</option>
              <option value="lastFoundAt">Последний сбор</option>
              <option value="updatedAt">Обновление в базе</option>
              <option value="createdAt">Создан в базе</option>
            </select>
          </label>
          <label className="field-label">С<input className="input" type="date" name="dateFrom" defaultValue={paramText(params.dateFrom)} /></label>
          <label className="field-label">По<input className="input" type="date" name="dateTo" defaultValue={paramText(params.dateTo)} /></label>
          <label className="field-label span-2">Выбранные креативы<input className="input" name="creativeIds" placeholder="CR... через запятую" defaultValue={creativeIds} /></label>
        </div>

        <div className="panel-subsection export-fields-section">
          <h3 className="section-title">Поля выгрузки</h3>
          <div className="checkbox-grid export-checkbox-grid">
            {EXPORT_FIELDS.map((field) => (
              <label className="check-row" key={field}>
                <input type="checkbox" name="fields" value={field} defaultChecked={fields.includes(field)} />
                {fieldLabel(field)}
              </label>
            ))}
          </div>
        </div>
      </AutoFilterForm>

      <section className="panel export-table-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Таблица выгрузки</h2>
            <div className="muted chart-subtitle">Показаны первые {data.previewRows.length.toLocaleString("en-US")} строк из {data.previewCount.toLocaleString("en-US")} по текущему фильтру.</div>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {fields.map((field) => <th key={field}>{fieldLabel(field)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.previewRows.length ? data.previewRows.map((creative) => (
                <tr key={creative.id}>
                  {fields.map((field) => <td key={field}>{valueForField(field, creative)}</td>)}
                </tr>
              )) : (
                <tr>
                  <td colSpan={Math.max(fields.length, 1)} className="muted">По текущим фильтрам креативов нет</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stat-card compact-stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString("en-US")}</div>
    </div>
  );
}

function buildQuery(params: SearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => query.append(key, item));
    } else if (value) {
      query.set(key, value);
    }
  }
  return query.toString();
}

function paramText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function paramList(value: string | string[] | undefined) {
  if (!value) return [];
  return (Array.isArray(value) ? value : value.split(","))
    .flatMap((item) => item.split(/[,\s]+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectedFields(value: string | string[] | undefined, defaultFields: ExportField[]) {
  const requested = paramList(value);
  const valid = EXPORT_FIELDS.filter((field) => requested.includes(field));
  return valid.length ? valid : defaultFields.filter((field) => EXPORT_FIELDS.includes(field));
}

function fieldLabel(field: string) {
  return ({
    creativeId: "Креатив",
    advertiserId: "ID рекламодателя",
    advertiserName: "Рекламодатель",
    appId: "ID приложения",
    appName: "Приложение",
    store: "Магазин",
    format: "Формат",
    status: "Статус",
    countries: "Страны",
    firstShownAt: "Первый показ",
    lastShownAt: "Последний показ",
    publicDays: "Дней опубликован",
    impressions: "Показы",
    previewUrl: "Preview URL"
  } as Record<string, string>)[field] ?? field;
}

function valueForField(field: ExportField, creative: ExportRow) {
  const values: Record<ExportField, string> = {
    creativeId: creative.creativeId,
    advertiserId: creative.advertiser.googleAdvertiserId,
    advertiserName: creative.advertiser.name ?? "",
    appId: creative.app?.appId ?? "",
    appName: creative.app?.name ?? "",
    store: formatStore(creative.app?.store),
    format: formatCreativeFormat(creative.format),
    status: formatCreativeStatus(creative.status),
    countries: creative.countries.map((country) => country.countryCode ?? String(country.googleGeoId)).join(", "),
    firstShownAt: formatDate(creative.firstShownAt),
    lastShownAt: formatDate(creative.lastShownAt),
    publicDays: creative.publicDays === null ? "" : String(creative.publicDays),
    impressions: [creative.impressionsMin, creative.impressionsMax].filter((value) => value !== null && value !== undefined).join("-"),
    previewUrl: creative.previewUrl ?? ""
  };
  return values[field];
}

function formatDate(value: Date | null) {
  return value ? value.toLocaleDateString("ru-RU") : "";
}

function formatStore(value?: string) {
  if (value === "GOOGLE_PLAY") return "Google Play";
  if (value === "APP_STORE") return "App Store";
  if (value === "UNKNOWN") return "Неизвестно";
  return "";
}

function formatCreativeFormat(value: string) {
  return ({ VIDEO: "Видео", IMAGE: "Изображение", TEXT: "Текст", UNKNOWN: "Неизвестно" } as Record<string, string>)[value] ?? value;
}

function formatCreativeStatus(value: string) {
  return ({ ACTIVE: "Активен", STOPPED: "Остановлен", UNKNOWN: "Неизвестно" } as Record<string, string>)[value] ?? value;
}
