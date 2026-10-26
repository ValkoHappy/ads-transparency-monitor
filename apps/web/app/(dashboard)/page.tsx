import Link from "next/link";
import { formatCountries, formatDateTime, formatStoreLabel } from "@/components/display";
import { Icons } from "@/components/icons";
import { LiveRouteRefresh } from "@/components/live-route-refresh";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getDashboardData } from "@/lib/data";

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

export default async function DashboardPage() {
  const data = await getDashboardData();
  const hasLiveWork = data.scanStatusStats.some((item) => item.label === "RUNNING" || item.label === "QUEUED");

  return (
    <div className="dashboard-screen">
      <LiveRouteRefresh enabled={hasLiveWork} intervalMs={15000} />
      <PageHeader title="Дашборд" subtitle="Обзор рекламодателей, креативов, сборов и ошибок">
        <Link prefetch={false} className="button primary" href="/advertisers">
          <Icons.Plus size={16} />
          Добавить рекламодателя
        </Link>
      </PageHeader>

      <section className="dashboard-top-grid">
        <Stat label="Рекламодатели" value={data.advertisers} delta="в работе" />
        <Stat label="Креативы" value={data.creatives} delta="в базе" />
        <Stat label="Активные" value={data.activeCreatives} delta={`${activePercent(data.activeCreatives, data.creatives)}% от базы`} />
        <Stat label="Остановлены" value={Math.max(0, data.creatives - data.activeCreatives)} delta="по последним данным" />
        <Stat label="Приложения" value={data.apps} delta="найдено в preview" />
        <Stat label="Сканирования" value={data.scans} delta="история запусков" />
        <ScanStatusStrip items={data.scanStatusStats} />
      </section>

      <section className="dashboard-main-grid">
        <LinePanel title="Динамика сборов" subtitle="Найдено, detail и preview по последним запускам" items={data.scanVolumeStats} />
        <BarPanel title="Магазины" subtitle="Google Play, App Store и неизвестные источники" items={data.storeStats.map((item) => ({ ...item, label: formatStoreLabel(item.label) }))} />
        <BarPanel title="Топ стран" subtitle="Где встречаются креативы" items={data.countryStats} />
      </section>

      <section className="grid two-col dashboard-tables">
        <div className="panel dashboard-table-panel dashboard-advertisers-table">
          <div className="panel-header">
            <h2 className="panel-title">Последние рекламодатели</h2>
            <Link prefetch={false} className="button" href="/advertisers">Все</Link>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Рекламодатель</th>
                  <th>Страны</th>
                  <th>Креативы</th>
                  <th>Последний сбор</th>
                </tr>
              </thead>
              <tbody>
                {data.recentAdvertisers.map((advertiser) => (
                  <tr key={advertiser.id}>
                    <td>
                      <Link prefetch={false} href={`/advertisers/${advertiser.id}`}><strong>{advertiser.name ?? advertiser.googleAdvertiserId}</strong></Link>
                      <div className="muted">{advertiser.googleAdvertiserId}</div>
                    </td>
                    <td>{formatCountries(advertiser.selectedCountries)}</td>
                    <td>{advertiser.totalCreatives}</td>
                    <td>
                      <div>{formatDateTime(advertiser.lastScanAt)}</div>
                      <StatusBadge status={advertiser.lastScanStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel dashboard-table-panel dashboard-creatives-table">
          <div className="panel-header">
            <h2 className="panel-title">Последние креативы</h2>
            <Link prefetch={false} className="button" href="/creatives">Все</Link>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Креатив</th>
                  <th>Приложение</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.recentCreatives.map((creative) => (
                  <tr key={creative.id}>
                    <td><Link prefetch={false} href={`/creatives/${creative.creativeId}`}><strong>{creative.creativeId}</strong></Link></td>
                    <td>
                      <div>{creative.app?.name ?? creative.app?.appId ?? "Неизвестно"}</div>
                      <div className="muted">{formatStoreLabel(creative.app?.store)} · {creative.publicDays ?? "-"} дней</div>
                    </td>
                    <td><StatusBadge status={creative.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: number; delta: string }) {
  return (
    <div className="card stat-card compact-stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString("en-US")}</div>
      <div className="stat-delta">{delta}</div>
    </div>
  );
}

function ScanStatusStrip({ items }: { items: ChartItem[] }) {
  return (
    <div className="card scan-status-strip">
      <div className="stat-label">Статусы сканирований</div>
      <div className="status-strip-list">
        {items.length ? items.map((item) => (
          <div className="status-chip" key={item.label}>
            <span className={`legend-dot ${item.label === "SUCCESS" ? "green" : item.label === "BLOCKED" ? "orange" : "red"}`} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        )) : <span className="muted">Данных пока нет</span>}
      </div>
    </div>
  );
}

function BarPanel({ title, subtitle, items }: { title: string; subtitle: string; items: ChartItem[] }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="panel chart-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          <div className="muted chart-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="bar-chart">
        {items.length ? items.map((item) => (
          <div className="bar-row" key={item.label}>
            <div className="bar-label" title={item.label}>{item.label}</div>
            <div className="bar-track">
              <span className={item.status === "FAILED" || item.status === "BLOCKED" ? "danger" : ""} style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} />
            </div>
            <strong>{item.value.toLocaleString("en-US")}</strong>
          </div>
        )) : <div className="muted">Данных пока нет</div>}
      </div>
    </div>
  );
}

function LinePanel({ title, subtitle, items }: { title: string; subtitle: string; items: ChartItem[] }) {
  return (
    <div className="panel chart-panel dashboard-line-panel">
      <div className="panel-header chart-heading">
        <div>
          <h2 className="panel-title">{title}</h2>
          <div className="muted chart-subtitle">{subtitle}</div>
        </div>
        <ChartLegend />
      </div>
      <MultiLineChart items={items} width={1040} height={320} ariaLabel={title} />
    </div>
  );
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
    <svg className="line-chart dashboard-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
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

function clipSvgText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
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

function activePercent(active: number, total: number) {
  return total ? Math.round((active / total) * 100) : 0;
}
