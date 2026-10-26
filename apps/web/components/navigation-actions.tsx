"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icons } from "./icons";

type Theme = "light" | "dark";

export function BackButton() {
  const pathname = usePathname();

  if (pathname === "/") return null;

  return (
    <Link className="back-button" href={fallbackPath(pathname)} prefetch={false}>
      <Icons.ChevronLeft size={16} />
      Назад
    </Link>
  );
}

function fallbackPath(pathname: string) {
  if (pathname.startsWith("/advertisers/")) return "/advertisers";
  if (pathname.startsWith("/creatives/")) return "/creatives";
  if (pathname.startsWith("/preview/")) return "/creatives";
  if (pathname.startsWith("/export")) return "/creatives";
  if (pathname.startsWith("/settings")) return "/";
  if (pathname.startsWith("/scans")) return "/";
  return "/";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = readTheme();
    applyTheme(initial);
    const frame = requestAnimationFrame(() => setTheme(initial));
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    const next = readTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button className="nav-button theme-toggle" type="button" onClick={toggleTheme}>
      {theme === "dark" ? <Icons.Sun size={18} /> : <Icons.Moon size={18} />}
      {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
    </button>
  );
}

function readTheme(): Theme {
  const domTheme = normalizeTheme(document.documentElement.dataset.theme);
  if (domTheme) return domTheme;

  try {
    return normalizeTheme(window.localStorage.getItem("theme")) ?? "light";
  } catch {
    return "light";
  }
}

function applyTheme(nextTheme: Theme) {
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  try {
    window.localStorage.setItem("theme", nextTheme);
  } catch {}
}

function normalizeTheme(value: string | null | undefined): Theme | null {
  return value === "dark" || value === "light" ? value : null;
}
