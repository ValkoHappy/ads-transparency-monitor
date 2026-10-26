import { EXPORT_FIELDS } from "@ad-monitor/db";
import { AutoSaveSettingsForm } from "@/components/auto-save-settings-form";
import { formatDateTime, formatSchedule, formatScheduleHours, nextScheduledScanTime } from "@/components/display";
import { McpAccessPanel } from "@/components/mcp-access-panel";
import { ScanSettingsFields } from "@/components/scan-settings-fields";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getSettingsData } from "@/lib/data";
import { updateSettingsAction } from "../actions";

export default async function SettingsPage() {
  const data = await getSettingsData();
  const settings = data.settings;
  const system = data.systemStatus;
  const googleClient = process.env.GOOGLE_CLIENT ?? "browser-native";

  return (
    <div className="settings-screen">
      <PageHeader title="Настройки" subtitle="Параметры кабинета, сканирования, экспорта и прокси" />

      <AutoSaveSettingsForm action={updateSettingsAction} className="settings-layout settings-form">
        <div className="settings-column">
          <section className="panel compact-panel">
            <div className="panel-header"><h2 className="panel-title">Доступ</h2></div>
            <div className="form-grid">
              <label className="field-label">Почта администратора<input className="input" value={data.adminEmail} readOnly /></label>
              <label className="field-label">Название кабинета<input className="input" value={data.appName} readOnly /></label>
              <p className="muted compact-note">Секреты входа задаются через env. Настройки ниже сохраняются автоматически.</p>
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Состояние системы</h2>
              <StatusBadge status={system.ok ? "SUCCESS" : "FAILED"} />
            </div>
            <div className="settings-list">
              <Row label="База" value={system.ok ? `OK, ${system.latencyMs} мс` : system.error ?? "Ошибка"} />
              <Row label="Worker" value={`${system.workerOnline ? "онлайн" : "нет heartbeat"} · ${system.workerStatus}${system.workerMessage ? ` · ${formatWorkerMessage(system.workerMessage)}` : ""}`} />
              <Row label="Google" value={system.google ? `${system.google.status}${system.google.blockedUntil ? ` до ${formatDateTime(system.google.blockedUntil)}` : ""}` : "нет данных"} />
              <Row label="Движок сбора" value={googleClient === "browser-native" ? "Браузерный" : googleClient} />
              <Row label="Очередь" value={`queued ${system.queued}, running ${system.running}, failed ${system.failed}`} />
              <Row label="Последний успех" value={formatDateTime(system.lastSuccessAt)} />
              <Row label="Без приложения" value={String(system.creativesWithoutApp)} />
              <Row label="Без preview URL" value={String(system.creativesWithoutPreviewUrl)} />
              <Row label="Raw snapshots" value={String(system.rawSnapshots)} />
            </div>
          </section>

          <section className="panel compact-panel settings-export-panel">
            <div className="panel-header"><h2 className="panel-title">Экспорт по умолчанию</h2></div>
            <div className="checkbox-grid">
              {EXPORT_FIELDS.map((field) => (
                <label className="check-row" key={field}>
                  <input type="checkbox" name="exportDefaultFields" value={field} defaultChecked={settings.exportDefaultFields.includes(field)} />
                  {fieldLabel(field)}
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="settings-column">
          <section className="panel compact-panel">
            <div className="panel-header"><h2 className="panel-title">Сканирование</h2></div>
            <ScanSettingsFields
              scanMode={settings.scanMode}
              scheduleType={settings.scheduleType ?? "DAILY"}
              requestDelayMs={settings.requestDelayMs}
              workerConcurrency={settings.workerConcurrency}
              scanIntervalHours={settings.scanIntervalHours ?? 24}
              dailyScanHours={formatScheduleHours(settings)}
              maxPagesPerRun={settings.maxPagesPerRun}
              maxCreativesPerRun={settings.maxCreativesPerRun}
              scheduleSummary={`Сейчас: ${formatSchedule(settings)}. Следующий запуск: ${formatDateTime(nextScheduledScanTime(new Date(), settings))}`}
            />
            <div className="inline-fields">
              <label className="field-label">Пауза между рекламодателями, мс<input className="input" name="advertiserDelayMs" type="number" min="0" max="3600000" defaultValue={settings.advertiserDelayMs} /></label>
              <label className="field-label">Интервал probe, мс<input className="input" name="probeIntervalMs" type="number" min="60000" max="86400000" defaultValue={settings.probeIntervalMs} /></label>
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header"><h2 className="panel-title">Прокси и хранение</h2></div>
            <div className="form-grid">
              <label className="check-row"><input type="checkbox" name="proxyEnabled" defaultChecked={settings.proxyEnabled} />Использовать прокси</label>
              <label className="field-label">Proxy URL<input className="input" name="proxyUrl" placeholder="socks5://user:pass@host:port или host:port:user:pass" defaultValue={settings.proxyUrl ?? ""} /></label>
              <label className="field-label">Proxy pool<textarea className="input textarea" name="proxyPool" placeholder="socks5://user:pass@host:port или host:port:user:pass" defaultValue={data.proxies.map((proxy) => proxy.url).join("\n")} /></label>
              <div className="proxy-health-list">
                {data.proxies.length ? data.proxies.map((proxy) => (
                  <div className="proxy-health-row" key={proxy.id}>
                    <span className="proxy-url">{maskProxyUrl(proxy.url)}</span>
                    <StatusBadge status={proxy.status === "OK" ? "SUCCESS" : proxy.status === "FAILED" ? "FAILED" : "BLOCKED"} />
                    <span className="muted">{proxy.status}</span>
                    <span className="muted">fail {proxy.failCount}</span>
                    <span className="muted">{proxy.blockedUntil ? `до ${formatDateTime(proxy.blockedUntil)}` : "без cooldown"}</span>
                    {proxy.lastError ? <span className="muted truncate">{proxy.lastError}</span> : null}
                  </div>
                )) : <p className="muted compact-note">Прокси в пуле нет.</p>}
              </div>
              <div className="inline-fields">
                <label className="field-label">Raw snapshots, дней<input className="input" name="rawSnapshotRetentionDays" type="number" min="1" max="365" defaultValue={settings.rawSnapshotRetentionDays} /></label>
                <label className="field-label">События, дней<input className="input" name="scanEventRetentionDays" type="number" min="1" max="365" defaultValue={settings.scanEventRetentionDays} /></label>
              </div>
              <div className="settings-list">
                <Row label="База" value={data.databaseUrl} />
                <Row label="Рекламодатели" value={String(data.advertisers)} />
                <Row label="Креативы" value={String(data.creatives)} />
                <Row label="Прокси" value={String(data.proxies.length)} />
              </div>
            </div>
          </section>
        </div>
      </AutoSaveSettingsForm>

      <div className="settings-layout">
        <div className="settings-column settings-column-full">
          <McpAccessPanel endpoint="/api/settings/mcp-tokens" initialTokens={data.mcpTokens} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-row">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
    publicDays: "Дней публичен",
    impressions: "Показы",
    previewUrl: "Preview URL"
  } as Record<string, string>)[field] ?? field;
}

function formatWorkerMessage(message: string) {
  const iso = message.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0];
  if (!iso) return message;
  return message.replace(iso, formatDateTime(new Date(iso)));
}

function maskProxyUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:@]+):([^@]+)@/, "://***:***@");
  }
}
