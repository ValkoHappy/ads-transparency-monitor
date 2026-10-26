"use client";

import { useEffect, useMemo, useState } from "react";
import { formatScanMessage } from "./display";

export type ScanLogEvent = {
  id: string;
  level: string;
  message: string;
  createdAt: string;
  data?: unknown;
};

export type ScanLogJob = {
  id: string;
  status: string;
  cancelRequested?: boolean | null;
  scanMode: string;
  createdAt: string;
  pagesFetched: number;
  creativesFound: number;
  detailsFetched: number;
  previewsFetched: number;
  events: ScanLogEvent[];
};

type ScanLogDialogProps = {
  buttonLabel?: string;
  job: ScanLogJob;
  liveJob?: ScanLogJob;
};

const MAX_RENDERED_EVENTS = 220;

export function ScanLogDialog({ buttonLabel = "Открыть журнал", job, liveJob: externalLiveJob }: ScanLogDialogProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState("ALL");
  const [fetchedJob, setFetchedJob] = useState<ScanLogJob | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveJob = fetchedJob?.id === job.id ? fetchedJob : externalLiveJob ?? job;
  const effectiveStatus = liveJob.cancelRequested && liveJob.status === "RUNNING" ? "Останавливается" : liveJob.status;
  const filteredEvents = useMemo(
    () => level === "ALL" ? liveJob.events : liveJob.events.filter((event) => event.level === level),
    [liveJob.events, level]
  );
  const events = filteredEvents.slice(0, MAX_RENDERED_EVENTS);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    async function loadEvents() {
      try {
        const response = await fetch(`/api/scans/${job.id}/events?limit=${MAX_RENDERED_EVENTS}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { job: ScanLogJob };
        if (!canceled) {
          setFetchedJob(payload.job);
          setLiveError(null);
        }
      } catch (error) {
        if (!canceled) setLiveError(error instanceof Error ? error.message : "Ошибка обновления");
      }
    }

    void loadEvents();
    const interval = window.setInterval(loadEvents, 2000);
    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [job.id, open]);

  return (
    <>
      <button className="button" type="button" onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }}>{buttonLabel}</button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div className="log-modal" role="dialog" aria-modal="true" aria-label="Журнал сканирования" onMouseDown={(event) => event.stopPropagation()}>
            <div className="log-modal-header">
              <div>
                <h2>Журнал сканирования</h2>
                <p>{effectiveStatus} · {liveJob.scanMode} · {liveJob.creativesFound} креативов · {liveJob.pagesFetched} стр. · автообновление 2с</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Закрыть">x</button>
            </div>
            {liveError ? <div className="status-note error">Журнал не обновился: {liveError}</div> : null}
            <div className="log-toolbar">
              {["ALL", "info", "warn", "error"].map((item) => (
                <button className={level === item ? "tab-link active" : "tab-link"} type="button" key={item} onClick={() => setLevel(item)}>
                  {item === "ALL" ? "Все" : item.toUpperCase()}
                </button>
              ))}
              {filteredEvents.length > events.length ? <span className="muted">Показаны последние {events.length} событий</span> : null}
            </div>
            <pre className="console-log">{events.length ? events.map(formatEvent).join("\n") : "Событий нет"}</pre>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatEvent(event: ScanLogEvent) {
  const time = new Date(event.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const data = eventDataLabel(event.data);
  return `[${time}] ${event.level.toUpperCase().padEnd(5)} ${formatScanMessage(event.message)}${data ? `  ${data}` : ""}`;
}

function eventDataLabel(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const row = data as Record<string, unknown>;
  const parts = [
    typeof row.reasonCode === "string" ? `reason=${row.reasonCode}` : undefined,
    typeof row.creativeId === "string" ? `creative=${row.creativeId}` : undefined,
    typeof row.creatives === "number" ? `creatives=${row.creatives}` : undefined,
    typeof row.page === "number" ? `page=${row.page}` : undefined
  ].filter(Boolean);
  return parts.length ? `{ ${parts.join(" ")} }` : "";
}
