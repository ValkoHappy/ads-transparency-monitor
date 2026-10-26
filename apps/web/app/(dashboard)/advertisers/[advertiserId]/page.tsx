import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DeleteAdvertiserButton } from "@/components/delete-advertiser-button";
import { formatCountries, formatCreativeFormat, formatDateTime, formatScanMessage, formatScanMode, formatStoreLabel, nextScheduledScanTime, transparencyAdvertiserUrl, transparencyCreativeUrl } from "@/components/display";
import { Icons } from "@/components/icons";
import { PendingButton } from "@/components/pending-button";
import { ScanLogDialog } from "@/components/scan-log-dialog";
import { ScanProgressLive } from "@/components/scan-progress-live";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getAdvertiser, getAppSettings } from "@/lib/data";
import { safeExternalHttpUrl } from "@/lib/media-url";
import { cancelScanAction, queueScanAction, runFullScanAction, updateAdvertiserAction } from "../../actions";

type Advertiser = NonNullable<Awaited<ReturnType<typeof getAdvertiser>>>;
type ScanJob = Advertiser["scanJobs"][number];

export default async function AdvertiserDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ advertiserId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { advertiserId } = await params;
  const { tab = "creatives" } = await searchParams;
  const [advertiser, settings] = await Promise.all([getAdvertiser(advertiserId, { scanEventsLimit: tab === "errors" ? 200 : 1 }), getAppSettings()]);
  if (!advertiser) notFound();

  const apps = uniqueBy(advertiser.creatives.map((creative) => creative.app).filter(Boolean), (app) => app!.id);
  const countries = uniqueBy(advertiser.creatives.flatMap((creative) => creative.countries), (country) => String(country.googleGeoId));
  const errors = advertiser.scanJobs.flatMap((job) => job.events.filter((event) => event.level === "error").map((event) => ({ ...event, job })));
  const latestJob = advertiser.scanJobs[0];
  const activeJob = latestJob && ["QUEUED", "RUNNING"].includes(latestJob.status) ? latestJob : null;
  const selectedCountries = advertiser.selectedCountries.join(",");

  return (
    <div className="advertiser-detail-screen">
      <PageHeader title={advertiser.name ?? advertiser.googleAdvertiserId} subtitle={advertiser.googleAdvertiserId}>
        <a className="button" href={transparencyAdvertiserUrl(advertiser.googleAdvertiserId, { startDate: advertiser.scanStartDate, endDate: advertiser.scanEndDate })} rel="noreferrer" target="_blank"><Icons.ExternalLink size={16} />Transparency</a>
        <Link className="button" href={`/export?advertiserId=${advertiser.id}`} prefetch={false}><Icons.Download size={16} />Экспорт</Link>
        <DeleteAdvertiserButton advertiserId={advertiser.id} advertiserName={advertiser.name ?? advertiser.googleAdvertiserId} redirectTo="/advertisers" />
        {activeJob ? (
          <form action={cancelScanAction} className="inline-form">
            <input name="scanJobId" type="hidden" value={activeJob.id} />
            <PendingButton className="button danger" pendingText="Останавливаем" type="submit">
              <Icons.CircleStop size={16} />Остановить
            </PendingButton>
          </form>
        ) : null}
        <form action={queueScanAction} className="inline-form">
          <input name="advertiserId" type="hidden" value={advertiser.id} />
          <input name="countries" type="hidden" value={selectedCountries} />
          <input name="returnTo" type="hidden" value={`/advertisers/${advertiser.id}`} />
          <PendingButton className="button" disabled={Boolean(activeJob)} pendingText="Ставим в очередь" type="submit">
            <Icons.TimerReset size={16} />{activeJob?.status === "RUNNING" ? "В процессе" : activeJob ? "В очереди" : "В очередь"}
          </PendingButton>
        </form>
        <form action={runFullScanAction} className="inline-form">
          <input name="advertiserId" type="hidden" value={advertiser.id} />
          <input name="countries" type="hidden" value={selectedCountries} />
          <input name="returnTo" type="hidden" value={`/advertisers/${advertiser.id}`} />
          <PendingButton className="button primary" disabled={Boolean(activeJob)} pendingText="Запускаем полный сбор" type="submit">
            <Icons.Search size={16} />{activeJob?.status === "RUNNING" ? "В процессе" : activeJob ? "В очереди" : "Полный сбор"}
          </PendingButton>
        </form>
      </PageHeader>

      <section className="grid stats-grid">
        <Stat label="Креативы" value={advertiser.totalCreatives} />
        <Stat label="Активные" value={advertiser.activeCreatives} />
        <Info label="Страны" value={formatCountries(advertiser.selectedCountries)} />
        <Stat label="Сканов" value={advertiser.scanJobs.length} />
        <Info label="Последний скан" value={formatDateTime(advertiser.lastScanAt)} />
        <Info label="Следующий скан" value={advertiser.dailyScanEnabled ? formatDateTime(advertiser.nextScanAt ?? nextScheduledScanTime(new Date(), settings)) : "выключено"} />
      </section>

      <section className="panel advertiser-settings-strip" style={{ marginTop: 10 }}>
        <div className="details-grid">
          <InfoLine label="Страны" value={formatCountries(advertiser.selectedCountries)} />
          <InfoLine label="Режим" value={formatScanMode(advertiser.scanMode)} />
          <InfoLine label="Пауза" value={`${advertiser.requestDelayMs ?? "по умолчанию"} мс`} />
          <InfoLine label="Объём сбора" value="без ограничений" />
          <InfoLine label="География" value="все страны" />
          <InfoLine label="Статус" value={<StatusBadge status={advertiser.lastScanStatus} />} />
        </div>
      </section>

      {latestJob ? <ScanProgressLive job={{ ...scanLogJob(latestJob), countries: latestJob.countries }} /> : null}

      <nav className="tabs">
        <Tab href={`/advertisers/${advertiser.id}?tab=creatives`} active={tab === "creatives"} label="Креативы" />
        <Tab href={`/advertisers/${advertiser.id}?tab=apps`} active={tab === "apps"} label="Приложения" />
        <Tab href={`/advertisers/${advertiser.id}?tab=countries`} active={tab === "countries"} label="Страны" />
        <Tab href={`/advertisers/${advertiser.id}?tab=scans`} active={tab === "scans"} label="Сканы" />
        <Tab href={`/advertisers/${advertiser.id}?tab=errors`} active={tab === "errors"} label="Ошибки" />
        <Tab href={`/advertisers/${advertiser.id}?tab=source`} active={tab === "source"} label="Данные источника" />
        <Tab href={`/advertisers/${advertiser.id}?tab=settings`} active={tab === "settings"} label="Настройки" />
      </nav>

      {tab === "creatives" ? <section className="panel advertiser-tab-panel">
        <div className="panel-header">
          <h2 className="panel-title">Креативы рекламодателя</h2>
          <Link className="button" href={`/creatives?advertiserId=${advertiser.id}`} prefetch={false}>Все креативы</Link>
        </div>
        <div className="table-scroll advertiser-table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Креатив</th>
                <th>Приложение</th>
                <th>Магазин</th>
                <th>Формат</th>
                <th>Страны</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {advertiser.creatives.map((creative, index) => (
                <tr key={creative.id}>
                  <td>{index + 1}</td>
                  <td><Link href={`/creatives/${creative.creativeId}`} prefetch={false}><strong>{creative.creativeId}</strong></Link></td>
                  <td>{creative.app?.name ?? creative.app?.appId ?? "-"}</td>
                  <td>{formatStoreLabel(creative.app?.store)}</td>
                  <td>{formatCreativeFormat(creative.format)}</td>
                  <td>{creative.countries.slice(0, 5).map((country) => country.countryCode).filter(Boolean).join(", ") || "-"}</td>
                  <td><StatusBadge status={creative.status} /></td>
                  <td className="actions-cell">
                    <Link className="icon-button" href={`/creatives/${creative.creativeId}`} prefetch={false} title="Открыть карточку"><Icons.Eye size={16} /></Link>
                    <a className="icon-button" href={transparencyCreativeUrl(advertiser.googleAdvertiserId, creative.creativeId)} rel="noreferrer" target="_blank" title="Открыть в Transparency Center"><Icons.ExternalLink size={16} /></a>
                    {creative.previewUrl ? <Link className="icon-button" href={`/preview/${creative.creativeId}`} prefetch={false} title="Открыть предпросмотр"><Icons.AppWindow size={16} /></Link> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section> : null}

      {tab === "apps" ? <section className="panel advertiser-tab-panel">
        <div className="panel-header"><h2 className="panel-title">Приложения</h2></div>
        <div className="table-scroll advertiser-table-scroll">
          <table className="table">
            <thead><tr><th>№</th><th>Приложение</th><th>Магазин</th><th>Разработчик</th><th>Категория</th></tr></thead>
            <tbody>{apps.map((app, index) => {
              const storeUrl = safeExternalHttpUrl(app!.storeUrl);
              return (
                <tr key={app!.id}>
                  <td>{index + 1}</td>
                  <td>{storeUrl ? <a href={storeUrl} rel="noreferrer" target="_blank"><strong>{app!.name ?? app!.appId}</strong></a> : <strong>{app!.name ?? app!.appId}</strong>}</td>
                  <td>{formatStoreLabel(app!.store)}</td>
                  <td>{app!.developer ?? "-"}</td>
                  <td>{app!.category ?? "-"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section> : null}

      {tab === "countries" ? <section className="panel advertiser-tab-panel">
        <div className="panel-header"><h2 className="panel-title">Страны</h2></div>
        <div className="table-scroll advertiser-table-scroll">
          <table className="table">
            <thead><tr><th>№</th><th>Страна</th><th>Geo ID</th><th>Первый показ</th><th>Последний показ</th></tr></thead>
            <tbody>{countries.map((country, index) => (
              <tr key={country.id}>
                <td>{index + 1}</td>
                <td>{country.countryCode ?? "-"} <span className="muted">{country.countryName}</span></td>
                <td>{country.googleGeoId}</td>
                <td>{country.firstShownDate ?? "-"}</td>
                <td>{country.lastShownDate ?? "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section> : null}

      {tab === "scans" ? <section className="panel advertiser-tab-panel">
        <div className="panel-header">
          <h2 className="panel-title">История сканирований</h2>
          <span className="muted">Страны: все страны</span>
        </div>
        <div className="table-scroll advertiser-table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Создано</th>
                <th>Завершено</th>
                <th>Статус</th>
                <th>Страниц</th>
                <th>Креативов</th>
                <th>Детали</th>
                <th>Preview</th>
                <th>Последнее событие</th>
                <th>Журнал</th>
              </tr>
            </thead>
            <tbody>
              {advertiser.scanJobs.map((job, index) => (
                <tr key={job.id}>
                  <td>{index + 1}</td>
                  <td>{formatDateTime(job.createdAt)}</td>
                  <td>{formatDateTime(job.finishedAt)}</td>
                  <td><StatusBadge status={job.status} /></td>
                  <td>{job.pagesFetched}</td>
                  <td>{job.creativesFound}</td>
                  <td>{job.detailsFetched}</td>
                  <td>{job.previewsFetched}</td>
                  <td>{formatScanMessage(job.blockedReason ?? job.events[0]?.message ?? job.errorMessage)}</td>
                  <td><ScanLogDialog buttonLabel="Логи" job={scanLogJob(job)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section> : null}

      {tab === "errors" ? <section className="panel advertiser-tab-panel">
        <div className="panel-header"><h2 className="panel-title">Ошибки</h2></div>
        {errors.length ? <table className="table">
          <thead><tr><th>№</th><th>Дата</th><th>Статус</th><th>Сообщение</th></tr></thead>
          <tbody>{errors.map((event, index) => (
            <tr key={event.id}>
              <td>{index + 1}</td>
              <td>{formatDateTime(event.createdAt)}</td>
              <td><StatusBadge status={event.job.status} /></td>
              <td>{formatScanMessage(event.message)}</td>
            </tr>
          ))}</tbody>
        </table> : <div className="empty-state"><h2 className="panel-title">Ошибок нет</h2><p className="muted">Когда Google вернёт 403/429 или сбор упадёт, детали появятся здесь.</p></div>}
      </section> : null}

      {tab === "source" ? <section className="panel advertiser-tab-panel">
        <div className="panel-header"><h2 className="panel-title">Данные источника</h2></div>
        <pre className="raw-box">{JSON.stringify({
          advertiserId: advertiser.googleAdvertiserId,
          transparencyUrl: advertiser.transparencyUrl,
          selectedCountries: advertiser.selectedCountries,
          scanJobs: advertiser.scanJobs.map((job) => ({ id: job.id, status: job.status, blockedReason: job.blockedReason }))
        }, null, 2)}</pre>
      </section> : null}

      {tab === "settings" ? <section className="panel advertiser-tab-panel">
        <div className="panel-header">
          <h2 className="panel-title">Настройки рекламодателя</h2>
          <span className="muted">{advertiser.googleAdvertiserId}</span>
        </div>
        <form className="advertiser-settings-form" action={updateAdvertiserAction}>
          <input name="advertiserId" type="hidden" value={advertiser.id} />
          <label className="field">
            <span>Название</span>
            <input className="input" name="name" defaultValue={advertiser.name ?? ""} placeholder="Название в кабинете" />
          </label>
          <label className="field">
            <span>Страны</span>
            <input className="input" name="countries" defaultValue={advertiser.selectedCountries.join(", ")} placeholder="Пусто = все страны" />
          </label>
          <label className="field">
            <span>Режим сбора</span>
            <select className="select" name="scanMode" defaultValue={advertiser.scanMode ?? ""}>
              <option value="">По умолчанию</option>
              <option value="FAST">Быстрый</option>
              <option value="FULL">Полный</option>
              <option value="CAUTIOUS">Осторожный</option>
            </select>
          </label>
          <label className="field">
            <span>Пауза между запросами, мс</span>
            <input className="input" name="requestDelayMs" defaultValue={advertiser.requestDelayMs ?? ""} placeholder="По умолчанию" inputMode="numeric" />
          </label>
          <label className="field">
            <span>Дата начала</span>
            <input className="input" name="scanStartDate" type="date" defaultValue={advertiser.scanStartDate ?? ""} />
          </label>
          <label className="field">
            <span>Дата окончания</span>
            <input className="input" name="scanEndDate" type="date" defaultValue={advertiser.scanEndDate ?? ""} />
          </label>
          <label className="check-row">
            <input name="dailyScanEnabled" type="checkbox" defaultChecked={advertiser.dailyScanEnabled} />
            Ежедневный автосбор включен
          </label>
          <label className="field span-2">
            <span>Заметка</span>
            <textarea className="input textarea" name="notes" defaultValue={advertiser.notes ?? ""} placeholder="Внутренняя заметка" />
          </label>
          <div className="form-footer span-2">
            <span className="muted">Пустое название можно оставить: оно подтянется из Google при успешном скане.</span>
            <PendingButton className="button primary" pendingText="Сохраняем" type="submit">Сохранить</PendingButton>
          </div>
        </form>
      </section> : null}
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return <Link className={`tab-link ${active ? "active" : ""}`} href={href} prefetch={false}>{label}</Link>;
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString("en-US")}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}

function scanLogJob(job: ScanJob) {
  return {
    id: job.id,
    status: job.status,
    cancelRequested: job.cancelRequested,
    scanMode: job.scanMode,
    createdAt: job.createdAt.toISOString(),
    pagesFetched: job.pagesFetched,
    creativesFound: job.creativesFound,
    detailsFetched: job.detailsFetched,
    previewsFetched: job.previewsFetched,
    events: job.events.map((event) => ({
      id: event.id,
      level: event.level,
      message: formatScanMessage(event.message),
      createdAt: event.createdAt.toISOString(),
      data: event.data
    }))
  };
}
