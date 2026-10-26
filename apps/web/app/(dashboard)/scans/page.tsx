import Link from "next/link";
import { formatCountries, formatDateTime, formatScanMessage, formatSchedule, nextScheduledScanTime } from "@/components/display";
import { Icons } from "@/components/icons";
import { LiveRouteRefresh } from "@/components/live-route-refresh";
import { PendingButton } from "@/components/pending-button";
import { ScanLogDialog } from "@/components/scan-log-dialog";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getAppSettings, getScans, getSystemStatusData } from "@/lib/data";
import { cancelScanAction, retryScanAction } from "../actions";

type ScanJob = Awaited<ReturnType<typeof getScans>>[number];

type ChartItem = {
  label: string;
  timeLabel?: string;
  dateTimeLabel?: string;
  finishedTimeLabel?: string | null;
  value: number;
  details?: number;
  previews?: number;
  status?: string;
  advertiserName?: string;
  googleAdvertiserId?: string;
};

const SCAN_CHART_LIMIT = 24;
const SCAN_CHART_WIDTH = 2200;
const SCAN_CHART_HEIGHT = 360;

export default async function ScansPage() {
  const [scans, settings, systemStatus] = await Promise.all([getScans(), getAppSettings(), getSystemStatusData()]);
  const nextScanAt = nextScheduledScanTime(new Date(), settings);
  const statusStats = countBy(scans, (scan) => scan.cancelRequested && scan.status === "RUNNING" ? "STOPPING" : scan.status);
  const queueNote = scanQueueNote(systemStatus);
  const hasLiveWork = scans.some((scan) => scan.status === "RUNNING" || scan.status === "QUEUED" || scan.cancelRequested) || systemStatus.workerStatus === "running";

  return (
    <div className="scans-screen">
      <LiveRouteRefresh enabled={hasLiveWork} intervalMs={10000} />
      <PageHeader title="Сканирования" subtitle={`Очередь, прогресс, результаты и ошибки. Автозапуск: ${formatSchedule(settings)}, следующий ${formatDateTime(nextScanAt)}`} />

      <section className="panel scan-summary-panel">
        <SummaryItem label="Всего запусков" value={String(scans.length)} />
        <SummaryItem label="В очереди" value={String(scans.filter((scan) => scan.status === "QUEUED").length)} hint={queueNote ?? undefined} />
        <SummaryItem label="Google" value={systemStatus.google?.status ?? "unknown"} hint={queueNote ?? undefined} />
        <div className="scan-status-inline">
          <span className="status-chip">
            <span className={`legend-dot ${systemStatus.google?.status === "BLOCKED" ? "orange" : "green"}`} />
            GOOGLE: <strong>{systemStatus.google?.status ?? "unknown"}</strong>
          </span>
          <span className="status-chip">
            <span className={`legend-dot ${systemStatus.workerOnline ? "green" : "red"}`} />
            WORKER: <strong>{systemStatus.workerStatus}</strong>
          </span>
          {statusStats.map((item) => (
            <span className="status-chip" key={item.label}>
              <span className={`legend-dot ${item.label === "SUCCESS" ? "green" : item.label === "BLOCKED" || item.label === "STOPPING" ? "orange" : item.label === "QUEUED" ? "blue" : "red"}`} />
              {item.label}: <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </section>

      <section className="panel chart-panel scan-chart-panel">
        <div className="panel-header chart-heading">
          <div>
            <h2 className="panel-title">Объем последних запусков</h2>
            <div className="muted chart-subtitle">Найдено / detail / preview по каждому запуску</div>
          </div>
          <ChartLegend />
        </div>
        <MultiLineChart items={scanVolumeItems(scans)} width={SCAN_CHART_WIDTH} height={SCAN_CHART_HEIGHT} ariaLabel="Объем последних запусков" />
      </section>

      <section className="panel compact-panel scans-table-panel">
        {scans.length ? (
          <div className="table-scroll scans-table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Рекламодатель</th>
                  <th>Страны</th>
                  <th>Создано</th>
                  <th>Завершено</th>
                  <th>Найдено</th>
                  <th>Детали</th>
                  <th>Preview</th>
                  <th>Статус</th>
                  <th className="scan-event-column">Последнее событие</th>
                  <th className="scan-actions-column">Действия</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan, index) => {
                  const stopping = scan.cancelRequested && scan.status === "RUNNING";
                  return (
                    <tr key={scan.id}>
                      <td>{index + 1}</td>
                      <td><Link prefetch={false} href={`/advertisers/${scan.advertiser.id}`}>{scan.advertiser.name ?? scan.advertiser.googleAdvertiserId}</Link></td>
                      <td>{formatCountries(scan.countries)}</td>
                      <td>{formatDateTime(scan.createdAt)}</td>
                      <td>{formatDateTime(scan.finishedAt)}</td>
                      <td>{scan.creativesFound}</td>
                      <td>{scan.detailsFetched}</td>
                      <td>{scan.previewsFetched}</td>
                      <td><StatusBadge status={stopping ? "STOPPING" : scan.status} /></td>
                      <td className="scan-event-cell" title={stopping ? "Остановка запрошена, worker завершает текущий шаг." : scan.status === "QUEUED" && queueNote ? queueNote : formatScanMessage(scan.blockedReason ?? scan.events[0]?.message ?? scan.errorMessage)}>
                        {stopping ? "Остановка запрошена, worker завершает текущий шаг." : scan.status === "QUEUED" && queueNote ? queueNote : formatScanMessage(scan.blockedReason ?? scan.events[0]?.message ?? scan.errorMessage)}
                      </td>
                      <td className="actions-cell">
                        <ScanLogDialog buttonLabel="Логи" job={scanLogJob(scan)} />
                        <form action={retryScanAction} className="inline-form">
                          <input type="hidden" name="scanJobId" value={scan.id} />
                          <PendingButton className="icon-button" pendingText="" type="submit" title="Повторить"><Icons.TimerReset size={16} /></PendingButton>
                        </form>
                        {(scan.status === "QUEUED" || scan.status === "RUNNING") && !stopping ? (
                          <form action={cancelScanAction} className="inline-form">
                            <input type="hidden" name="scanJobId" value={scan.id} />
                            <PendingButton className="button" pendingText="Выполняется" type="submit">{scan.status === "QUEUED" ? "Снять" : "Остановить"}</PendingButton>
                          </form>
                        ) : stopping ? (
                          <span className="muted">Останавливается</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h2 className="panel-title">Сканирований пока нет</h2>
            <p className="muted">Добавьте рекламодателя и запустите проверку.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryItem({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="summary-item">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function scanVolumeItems(scans: ScanJob[]): ChartItem[] {
  return scans.slice(0, SCAN_CHART_LIMIT).reverse().map((scan) => ({
    label: new Date(scan.createdAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }),
    timeLabel: new Date(scan.createdAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }),
    dateTimeLabel: new Date(scan.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    finishedTimeLabel: scan.finishedAt ? new Date(scan.finishedAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) : null,
    value: scan.creativesFound,
    details: scan.detailsFetched,
    previews: scan.previewsFetched,
    status: scan.cancelRequested && scan.status === "RUNNING" ? "STOPPING" : scan.status,
    advertiserName: scan.advertiser.name ?? scan.advertiser.googleAdvertiserId,
    googleAdvertiserId: scan.advertiser.googleAdvertiserId
  }));
}

function MultiLineChart({ items, width, height, ariaLabel }: { items: ChartItem[]; width: number; height: number; ariaLabel: string }) {
  const padding = { top: 28, right: 34, bottom: 42, left: 58 };
  const max = niceMax(Math.max(...items.flatMap((item) => [item.value, item.details ?? 0, item.previews ?? 0]), 1));
  const ticks = Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * index)).reverse();
  const baseY = height - padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const yFor = (value: number) => padding.top + (1 - value / max) * plotHeight;
  const pointsFor = (key: "value" | "details" | "previews") => items.map((item, index) => {
    const x = items.length === 1 ? padding.left + plotWidth / 2 : padding.left + (index / (items.length - 1)) * plotWidth;
    const value = key === "value" ? item.value : item[key] ?? 0;
    return { ...item, x, y: yFor(value), chartValue: value };
  });
  const mainPoints = pointsFor("value");
  const detailPoints = pointsFor("details");
  const previewPoints = pointsFor("previews");
  const mainLine = linePath(mainPoints);
  const area = mainPoints.length ? `${mainLine} L ${mainPoints[mainPoints.length - 1].x} ${baseY} L ${mainPoints[0].x} ${baseY} Z` : "";

  if (!items.length) return <div className="muted chart-empty">Данных пока нет</div>;

  return (
    <svg className="line-chart scan-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {ticks.map((tick, index) => {
        const y = yFor(tick);
        return (
          <g key={`${tick}-${index}`}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="chart-grid-line" />
            <text x={padding.left - 12} y={y + 4} textAnchor="end" className="chart-tick">{tick}</text>
          </g>
        );
      })}
      {items.map((item, index) => {
        const x = items.length === 1 ? padding.left + plotWidth / 2 : padding.left + (index / (items.length - 1)) * plotWidth;
        return <line key={`${item.label}-${index}-x`} x1={x} y1={padding.top} x2={x} y2={baseY} className="chart-grid-line vertical" />;
      })}
      <line x1={padding.left} y1={baseY} x2={width - padding.right} y2={baseY} className="chart-axis" />
      <path d={area} className="chart-area" />
      <path d={linePath(detailPoints)} className="chart-line chart-line-detail" />
      <path d={linePath(previewPoints)} className="chart-line chart-line-preview" />
      <path d={mainLine} className="chart-line" />
      {mainPoints.map((point, index) => (
        <g className="chart-hit-group" key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.y} r="5.5" className={point.status === "SUCCESS" ? "chart-point" : "chart-point danger"} />
          <text x={point.x} y={point.y - 11} textAnchor="middle" className="chart-value">{point.chartValue}</text>
          <text x={point.x} y={height - 22} textAnchor="middle" className="chart-label">{point.label}</text>
          {point.timeLabel ? <text x={point.x} y={height - 8} textAnchor="middle" className="chart-label chart-time-label">{point.timeLabel}</text> : null}
          <circle cx={point.x} cy={point.y} r="18" className="chart-hit-area" />
          <ChartTooltip point={point} width={width} />
        </g>
      ))}
    </svg>
  );
}

function ChartTooltip({ point, width }: { point: ChartItem & { x: number; y: number; chartValue: number }; width: number }) {
  const boxWidth = 230;
  const boxHeight = 112;
  const x = Math.min(Math.max(point.x - boxWidth / 2, 8), width - boxWidth - 8);
  const y = Math.max(point.y - boxHeight - 22, 8);
  const name = point.advertiserName ?? "Рекламодатель не указан";
  const advertiserId = point.googleAdvertiserId ?? "";

  return (
    <g className="chart-tooltip" transform={`translate(${x} ${y})`} pointerEvents="none">
      <rect width={boxWidth} height={boxHeight} rx="8" />
      <text x="12" y="22" className="chart-tooltip-title">{clipSvgText(name, 27)}</text>
      {advertiserId ? <text x="12" y="40" className="chart-tooltip-muted">{clipSvgText(advertiserId, 30)}</text> : null}
      <text x="12" y="62" className="chart-tooltip-row">{point.dateTimeLabel ?? `${point.label}${point.timeLabel ? ` ${point.timeLabel}` : ""}`} · {point.status ?? "UNKNOWN"}</text>
      {point.finishedTimeLabel ? <text x="12" y="80" className="chart-tooltip-muted">Завершено: {point.finishedTimeLabel}</text> : null}
      <text x="12" y={point.finishedTimeLabel ? "100" : "84"} className="chart-tooltip-row">Найдено {point.value} · Detail {point.details ?? 0} · Preview {point.previews ?? 0}</text>
    </g>
  );
}

function ChartLegend() {
  return (
    <div className="chart-legend">
      <span><i className="legend-line blue" />Найдено</span>
      <span><i className="legend-line cyan" />Detail</span>
      <span><i className="legend-line violet" />Preview</span>
    </div>
  );
}

function linePath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const prev = points[index - 1];
    const midX = (prev.x + point.x) / 2;
    return `C ${midX} ${prev.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
  }).join(" ");
}

function niceMax(value: number) {
  const base = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  return Math.ceil(value / base) * base;
}

function clipSvgText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
}

function scanLogJob(scan: ScanJob) {
  return {
    id: scan.id,
    status: scan.status,
    cancelRequested: scan.cancelRequested,
    scanMode: scan.scanMode,
    createdAt: scan.createdAt.toISOString(),
    pagesFetched: scan.pagesFetched,
    creativesFound: scan.creativesFound,
    detailsFetched: scan.detailsFetched,
    previewsFetched: scan.previewsFetched,
    events: scan.events.map((event) => ({
      id: event.id,
      level: event.level,
      message: formatScanMessage(event.message),
      createdAt: event.createdAt.toISOString(),
      data: event.data
    }))
  };
}

function scanQueueNote(systemStatus: Awaited<ReturnType<typeof getSystemStatusData>>) {
  const google = systemStatus.google;
  if (google?.status === "BLOCKED") {
    return google.blockedUntil
      ? `Google ограничил запросы до ${formatDateTime(google.blockedUntil)}`
      : "Google ограничил запросы, идет ожидание probe";
  }
  if (systemStatus.workerStatus === "cooldown" && systemStatus.workerMessage) {
    return formatScanMessage(systemStatus.workerMessage);
  }
  return null;
}

function countBy<T>(items: T[], getLabel: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = getLabel(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
