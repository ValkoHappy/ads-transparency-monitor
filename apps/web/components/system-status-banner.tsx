"use client";

import { useEffect, useState } from "react";

type SystemStatusPayload = {
  ok?: boolean;
  worker?: {
    online?: boolean;
    status?: string;
  };
  queue?: {
    queued?: number;
    running?: number;
  };
};

const REFRESH_MS = 60_000;
const INITIAL_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 8000;

export function SystemStatusBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function loadStatus() {
      if (document.hidden) return;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/system/status?lite=1", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as SystemStatusPayload;
        if (!canceled) setMessage(statusMessage(payload));
      } catch {
        if (!canceled) setMessage(null);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    const initial = window.setTimeout(loadStatus, INITIAL_DELAY_MS);
    const interval = window.setInterval(loadStatus, REFRESH_MS);
    window.addEventListener("visibilitychange", loadStatus);

    return () => {
      canceled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("visibilitychange", loadStatus);
    };
  }, []);

  return message ? <div className="system-banner">{message}</div> : null;
}

function statusMessage(payload: SystemStatusPayload) {
  if (payload.ok === false) return "База данных недоступна. Проверьте DATABASE_URL и Postgres.";
  if (payload.worker && payload.worker.online === false) {
    return `Worker не отвечает. Статус: ${payload.worker.status ?? "unknown"}. Очередь: ${payload.queue?.queued ?? 0}, выполняется: ${payload.queue?.running ?? 0}.`;
  }
  return null;
}
