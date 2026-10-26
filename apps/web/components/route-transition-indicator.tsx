"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";

const HIDE_TIMEOUT_MS = 12_000;
const SLOW_NAVIGATION_MS = 2_000;

export function RouteTransitionIndicator() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const slowTimeoutRef = useRef<number | null>(null);
  const pendingRef = useRef<{ startedAt: number; from: string; to: string; reason: string } | null>(null);

  useEffect(() => {
    const pendingNavigation = pendingRef.current;
    if (pendingNavigation) {
      sendClientPerf({
        event: "navigation-complete",
        from: pendingNavigation.from,
        to: currentPath(),
        reason: pendingNavigation.reason,
        durationMs: performance.now() - pendingNavigation.startedAt
      });
      pendingRef.current = null;
    }
    const frame = requestAnimationFrame(() => setPending(false));
    clearPendingTimeout(timeoutRef);
    clearPendingTimeout(slowTimeoutRef);
    return () => cancelAnimationFrame(frame);
  }, [pathname, search]);

  useEffect(() => {
    function startPending(reason: string, to: string) {
      const startedAt = performance.now();
      pendingRef.current = { startedAt, from: currentPath(), to, reason };
      setPending(true);
      clearPendingTimeout(timeoutRef);
      clearPendingTimeout(slowTimeoutRef);
      slowTimeoutRef.current = window.setTimeout(() => {
        const pendingNavigation = pendingRef.current;
        if (!pendingNavigation) return;
        sendClientPerf({
          event: "navigation-slow",
          from: pendingNavigation.from,
          to: pendingNavigation.to,
          reason: pendingNavigation.reason,
          pendingMs: performance.now() - pendingNavigation.startedAt
        });
      }, SLOW_NAVIGATION_MS);
      timeoutRef.current = window.setTimeout(() => setPending(false), HIDE_TIMEOUT_MS);
    }

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      startPending("link", `${url.pathname}${url.search}`);
    }

    function handleSubmit(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || form.method.toLowerCase() !== "get") return;
      const action = new URL(form.action || window.location.href, window.location.href);
      startPending("form-get", `${action.pathname}${action.search}`);
    }

    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
      clearPendingTimeout(timeoutRef);
      clearPendingTimeout(slowTimeoutRef);
    };
  }, []);

  return (
    <div className={`route-transition-indicator ${pending ? "active" : ""}`} aria-live="polite">
      <span className="route-spinner" aria-hidden="true" />
      Загружаем
    </div>
  );
}

function clearPendingTimeout(timeoutRef: MutableRefObject<number | null>) {
  if (!timeoutRef.current) return;
  window.clearTimeout(timeoutRef.current);
  timeoutRef.current = null;
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

function sendClientPerf(payload: Record<string, unknown>) {
  const body = JSON.stringify({
    ...payload,
    visibilityState: document.visibilityState,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },
    connection: connectionInfo()
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/telemetry/perf", new Blob([body], { type: "application/json" }));
    return;
  }

  void fetch("/api/telemetry/perf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true
  }).catch(() => undefined);
}

function connectionInfo() {
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean };
  }).connection;
  if (!connection) return undefined;
  return {
    effectiveType: connection.effectiveType,
    rtt: connection.rtt,
    downlink: connection.downlink,
    saveData: connection.saveData
  };
}
