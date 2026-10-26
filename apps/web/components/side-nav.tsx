"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";

const nav = [
  { href: "/", label: "Дашборд", icon: Icons.Gauge },
  { href: "/advertisers", label: "Рекламодатели", icon: Icons.Boxes },
  { href: "/creatives", label: "Креативы", icon: Icons.AppWindow },
  { href: "/scans", label: "Сканирования", icon: Icons.Search },
  { href: "/export", label: "Экспорт", icon: Icons.Download },
  { href: "/settings", label: "Настройки", icon: Icons.Settings }
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="nav-list">
      {nav.map((item) => {
        const active = item.href === "/"
          ? pathname === "/"
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`nav-link ${active ? "active" : ""}`}
            href={item.href}
            key={item.href}
            prefetch={false}
          >
            <item.icon size={18} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
