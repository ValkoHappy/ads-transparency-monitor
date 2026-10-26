"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCountries, formatDateTime, formatScanMode, formatStatusLabel } from "./display";
import { ScanLogDialog, type ScanLogJob } from "./scan-log-dialog";

type ScanProgressLiveProps = {
  job: ScanLogJob & {
    countries: string[];
  };
};

export function ScanProgressLive({ job }: ScanProgressLiveProps) {
  const [fetchedJob, setFetchedJob] = useState<ScanLogJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const liveJob = useMemo(() => (
    fetchedJob?.id === job.id ? { ...fetchedJob, countries: job.countries } : job
  ), [fetchedJob, job]);
  const shouldPoll = liveJob.status === "RUNNING" || liveJob.status === "QUEUED";
  const percent = scanProgressPercent(liveJob);
  const title = scanProgressTitle(liveJob);
  const helper = scanProgressHelper(liveJob, shouldPoll);

  useEffect(() => {
    if (!shouldPoll) return;
    let canceled = false;

    async function loadJob() {
      try {
        const response = await fetch(`/api/scans/${job.id}/events`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { job: ScanLogJob };
        if (!canceled) {
          setFetchedJob(payload.job);
          setError(null);
        }
      } catch (loadError) {
        if (!canceled) setError(loadError instanceof Error ? loadError.message : "Ошибка обновления");
      }
    }

    void loadJob();
    const interval = window.setInterval(loadJob, 2000);
    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [job.id, shouldPoll]);

  const logJob = useMemo(() => ({
    id: liveJob.id,
    status: liveJob.status,
    cancelRequested: liveJob.cancelRequested,
    scanMode: liveJob.scanMode,
    createdAt: liveJob.createdAt,
    pagesFetched: liveJob.pagesFetched,
    creativesFound: liveJob.creativesFound,
    detailsFetched: liveJob.detailsFetched,
    previewsFetched: liveJob.previewsFetched,
    events: liveJob.events
  }), [liveJob]);

  return (
    <section className="panel scan-progress-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Состояние сбора</h2>
          <p className="page-subtitle">{title}</p>
          {helper ? <p className="scan-helper">{helper}</p> : null}
          {error ? <p className="scan-helper error">Live-обновление не прошло: {error}</p> : null}
        </div>
        <div className="toolbar">
          <LiveStatusBadge job={liveJob} />
          <ScanLogDialog job={logJob} liveJob={logJob} />
        </div>
      </div>

      <div className="scan-progress-line">
        <div className="progress scan-progress" role="progressbar" aria-label="Прогресс сбора" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <strong>{percent}%</strong>
      </div>

      <div className="scan-metrics">
        <Metric label="Режим" value={formatScanMode(liveJob.scanMode)} />
        <Metric label="Страны" value={formatCountries(liveJob.countries)} />
        <Metric label="Создано" value={formatDateTime(liveJob.createdAt)} />
        <Metric label="Страниц" value={String(liveJob.pagesFetched)} />
        <Metric label="Креативов" value={String(liveJob.creativesFound)} />
        <Metric label="Detail / Preview" value={`${liveJob.detailsFetched} / ${liveJob.previewsFetched}`} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}

function LiveStatusBadge({ job }: { job: ScanLogJob }) {
  const value = job.cancelRequested && job.status === "RUNNING" ? "STOPPING" : job.status ?? "UNKNOWN";
  const color = value === "SUCCESS" || value === "ACTIVE"
    ? "green"
    : value === "FAILED" || value === "STOPPED" || value === "CANCELED"
      ? "red"
      : value === "BLOCKED" || value === "STOPPING"
        ? "orange"
        : "blue";
  return <span className={`badge ${color}`}>{value === "STOPPING" ? "Останавливается" : formatStatusLabel(value)}</span>;
}

function scanProgressTitle(job: ScanLogJob) {
  if (job.cancelRequested && job.status === "RUNNING") return "Остановка запрошена";
  if (job.status === "QUEUED" && job.scanMode === "FULL") return "Полный сбор поставлен в очередь";
  if (job.status === "QUEUED") return "Сбор поставлен в очередь";
  if (job.status === "RUNNING") return "Сбор выполняется";
  if (job.status === "SUCCESS") return "Сбор завершен";
  if (job.status === "BLOCKED") return "Google ограничил сбор";
  if (job.status === "CANCELED") return "Сбор остановлен";
  return "Сбор завершился с ошибкой";
}

function scanProgressHelper(job: ScanLogJob, live: boolean) {
  if (job.cancelRequested && job.status === "RUNNING") {
    return "Команда остановки принята. Worker завершает текущий scroll/request и сразу закроет задачу.";
  }
  if (job.status === "QUEUED") return "Задача создана и начнет выполняться, когда worker освободится.";
  if (job.status === "RUNNING") return live
    ? "Live-обновление включено: страницы, креативы, detail и preview подтягиваются каждые 2 секунды."
    : "Worker сейчас собирает страницы, detail и preview.";
  if (job.status === "BLOCKED") return "Google ограничил запросы. Задача сохранена в журнале, ее можно повторить позже.";
  return null;
}

function scanProgressPercent(job: ScanLogJob) {
  if (job.status === "SUCCESS" || job.status === "CANCELED") return 100;
  if (job.status === "FAILED" || job.status === "BLOCKED") return Math.max(8, Math.min(100, job.pagesFetched * 20 + job.detailsFetched * 5));
  if (job.status === "QUEUED") return 4;
  return Math.max(12, Math.min(95, job.pagesFetched * 20 + job.detailsFetched * 5 + job.previewsFetched * 5));
}
