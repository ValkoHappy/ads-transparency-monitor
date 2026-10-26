import Link from "next/link";
import { DeleteAdvertiserButton } from "@/components/delete-advertiser-button";
import { Icons } from "@/components/icons";
import { LiveRouteRefresh } from "@/components/live-route-refresh";
import { PendingButton } from "@/components/pending-button";
import { formatCountries, formatDateTime, formatScanMessage, nextScheduledScanTime, transparencyAdvertiserUrl } from "@/components/display";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getAdvertisers, getAppSettings } from "@/lib/data";
import { addAdvertiserAction, cancelScanAction, queueScanAction, runFullScanAction } from "../actions";

export default async function AdvertisersPage() {
  const [advertisers, settings] = await Promise.all([getAdvertisers(), getAppSettings()]);
  const activeJobs = advertisers
    .map((advertiser) => ({
      advertiserId: advertiser.id,
      job: advertiser.scanJobs[0] && ["QUEUED", "RUNNING"].includes(advertiser.scanJobs[0].status)
        ? advertiser.scanJobs[0]
        : null
    }))
    .filter((item): item is { advertiserId: string; job: NonNullable<typeof item.job> } => Boolean(item.job))
    .sort((left, right) => {
      const statusOrder = (left.job.status === "RUNNING" ? 0 : 1) - (right.job.status === "RUNNING" ? 0 : 1);
      if (statusOrder) return statusOrder;
      return left.job.scheduledFor.getTime() - right.job.scheduledFor.getTime()
        || left.job.createdAt.getTime() - right.job.createdAt.getTime();
    });
  const activeJobOrder = new Map(activeJobs.map((item, index) => [item.job.id, index + 1]));
  const runningJobCount = activeJobs.filter((item) => item.job.status === "RUNNING").length;
  const hasLiveWork = activeJobs.length > 0;

  return (
    <>
      <LiveRouteRefresh enabled={hasLiveWork} intervalMs={10000} />
      <PageHeader title="Рекламодатели" subtitle="Добавление рекламодателей и запуск проверок" />

      <section className="panel" style={{ marginBottom: 16 }}>
        <form className="form-row" action={addAdvertiserAction}>
          <input className="input" name="input" placeholder="ID рекламодателя или ссылка Transparency Center" required />
          <input className="input" name="name" placeholder="Название" />
          <input className="input" name="countries" placeholder="GB, BE, FR, DE" />
          <select className="select" name="scanMode" defaultValue="FULL">
            <option value="FULL">Полный сбор</option>
            <option value="FAST">Быстрый сбор</option>
            <option value="CAUTIOUS">Осторожный сбор</option>
          </select>
          <PendingButton className="button primary" pendingText="Добавляем" type="submit"><Icons.Plus size={16} />Добавить</PendingButton>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Список рекламодателей</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>№</th>
              <th>Рекламодатель</th>
              <th>Страны</th>
              <th>Креативы</th>
              <th>Последний скан</th>
              <th>Следующий</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {advertisers.map((advertiser, index) => {
              const latestJob = advertiser.scanJobs[0] ?? null;
              const activeJob = latestJob && ["QUEUED", "RUNNING"].includes(latestJob.status)
                ? latestJob
                : null;
              const latestIssue = !activeJob && latestJob
                ? formatScanMessage(latestJob.blockedReason ?? latestJob.events?.[0]?.message ?? latestJob.errorMessage)
                : null;

              return (
                <tr key={advertiser.id}>
                  <td>{index + 1}</td>
                  <td>
                    <Link prefetch={false} href={`/advertisers/${advertiser.id}`}><strong>{advertiser.name ?? advertiser.googleAdvertiserId}</strong></Link>
                    <div className="muted">{advertiser.googleAdvertiserId}</div>
                  </td>
                  <td>{formatCountries(advertiser.selectedCountries)}</td>
                  <td>{advertiser.totalCreatives}</td>
                  <td>{formatDateTime(advertiser.lastScanAt)}</td>
                  <td>{advertiser.dailyScanEnabled ? formatDateTime(advertiser.nextScanAt ?? nextScheduledScanTime(new Date(), settings)) : "выключено"}</td>
                  <td>
                    <StatusBadge status={activeJob?.status ?? advertiser.lastScanStatus} />
                    {activeJob ? <ScanQueueMeta job={activeJob} order={activeJobOrder.get(activeJob.id) ?? 0} runningJobCount={runningJobCount} /> : null}
                    {!activeJob && latestJob && latestJob.status !== "SUCCESS" && latestIssue && latestIssue !== "-" ? (
                      <div className="muted compact-note" title={latestIssue}>{latestIssue}</div>
                    ) : null}
                  </td>
                  <td className="actions-cell">
                    <Link prefetch={false} className="icon-button" href={`/advertisers/${advertiser.id}`} title="Открыть карточку"><Icons.Eye size={16} /></Link>
                    <a className="icon-button" href={transparencyAdvertiserUrl(advertiser.googleAdvertiserId)} rel="noreferrer" target="_blank" title="Открыть в Transparency Center"><Icons.ExternalLink size={16} /></a>
                    <Link prefetch={false} className="icon-button" href={`/export?advertiserId=${advertiser.id}`} title="Экспорт рекламодателя"><Icons.Download size={16} /></Link>
                    <DeleteAdvertiserButton advertiserId={advertiser.id} advertiserName={advertiser.name ?? advertiser.googleAdvertiserId} />
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
                      <input name="countries" type="hidden" value={advertiser.selectedCountries.join(",")} />
                      <PendingButton className="button" disabled={Boolean(activeJob)} pendingText="Ставим в очередь" type="submit">
                        <Icons.TimerReset size={16} />{activeJob?.status === "RUNNING" ? "В процессе" : activeJob ? "В очереди" : "Проверить"}
                      </PendingButton>
                    </form>
                    <form action={runFullScanAction} className="inline-form">
                      <input name="advertiserId" type="hidden" value={advertiser.id} />
                      <input name="countries" type="hidden" value={advertiser.selectedCountries.join(",")} />
                      <PendingButton className="button" disabled={Boolean(activeJob)} pendingText="Запускаем полный сбор" type="submit">
                        <Icons.Search size={16} />{activeJob?.status === "RUNNING" ? "В процессе" : activeJob ? "В очереди" : "Полный сбор"}
                      </PendingButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ScanQueueMeta({
  job,
  order,
  runningJobCount
}: {
  job: {
    status: string;
    pagesFetched: number;
    creativesFound: number;
    maxPagesPerRun: number | null;
    updatedAt: Date;
  };
  order: number;
  runningJobCount: number;
}) {
  const limit = job.maxPagesPerRun ? String(job.maxPagesPerRun) : "∞";
  const position = job.status === "RUNNING"
    ? `слот ${order}`
    : `очередь #${Math.max(1, order - runningJobCount)}`;

  return (
    <div className="muted compact-note">
      {position} · {job.pagesFetched}/{limit} стр. · {job.creativesFound} кр.
      <br />
      обновлено {formatDateTime(job.updatedAt)}
    </div>
  );
}
