import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "@/lib/auth";
import { formatStatusLabel } from "./display";
import { BackButton, ThemeToggle } from "./navigation-actions";
import { PendingButton } from "./pending-button";
import { RouteTransitionIndicator } from "./route-transition-indicator";
import { SideNav } from "./side-nav";
import { SystemStatusBanner } from "./system-status-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" prefetch={false}>
          <BrandMark />
          <div>
            <div className="brand-title">Ads Transparency</div>
            <div className="brand-subtitle">Monitor</div>
          </div>
        </Link>
        <SideNav />
        <div className="sidebar-footer">
          <ThemeToggle />
          <div className="user-box">
            <div className="brand-title">Admin</div>
            <div className="brand-subtitle">закрытый доступ</div>
            <form action={logoutAction} style={{ marginTop: 12 }}>
              <PendingButton className="nav-button" pendingText="Выходим" type="submit">Выйти</PendingButton>
            </form>
          </div>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={null}>
          <RouteTransitionIndicator />
        </Suspense>
        <BackButton />
        <SystemStatusBanner />
        {children}
      </main>
    </div>
  );
}

export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 44 44" role="img">
        <defs>
          <linearGradient id="logoPanel" x1="7" y1="5" x2="37" y2="39" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6BD5FF" />
            <stop offset="0.52" stopColor="#1E7CFF" />
            <stop offset="1" stopColor="#0B49C8" />
          </linearGradient>
          <linearGradient id="logoSignal" x1="17" y1="14" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#BFE4FF" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="36" height="36" rx="10" fill="url(#logoPanel)" />
        <path d="M14.5 17.5 22 13l7.5 4.5V26L22 30.5 14.5 26v-8.5Z" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.72)" strokeWidth="1.6" />
        <path d="M22 13v17.5M14.8 17.8 22 22l7.2-4.2" stroke="rgba(255,255,255,.55)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="29.5" cy="29.5" r="5.5" fill="url(#logoSignal)" />
        <path d="m33.7 33.7 3.2 3.2" stroke="#EAF6FF" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="29.5" cy="29.5" r="2.2" fill="#1668F5" />
      </svg>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="topbar">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {children ? <div className="toolbar">{children}</div> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  const value = status ?? "UNKNOWN";
  const color = value === "SUCCESS" || value === "ACTIVE"
    ? "green"
    : value === "FAILED" || value === "STOPPED" || value === "CANCELED"
      ? "red"
      : value === "BLOCKED" || value === "STOPPING"
        ? "orange"
        : "blue";
  return <span className={`badge ${color}`}>{value === "STOPPING" ? "Останавливается" : formatStatusLabel(value)}</span>;
}
