"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type LiveRouteRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
};

export function LiveRouteRefresh({ enabled, intervalMs = 10000 }: LiveRouteRefreshProps) {
  const router = useRouter();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      if (inFlight.current) return;
      if (document.hidden || !navigator.onLine) return;
      inFlight.current = true;
      startTransition(() => {
        router.refresh();
      });
      window.setTimeout(() => {
        inFlight.current = false;
      }, Math.min(Math.max(intervalMs / 2, 1000), 5000));
    };

    const interval = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, intervalMs, router]);

  return null;
}
