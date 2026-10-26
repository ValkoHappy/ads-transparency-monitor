"use client";

import { usePathname, useRouter } from "next/navigation";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useRef, useState, useTransition } from "react";

const INPUT_DEBOUNCE_MS = 650;

export function AutoFilterForm({
  children,
  className,
  style
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function apply(form: HTMLFormElement) {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams();
    const data = new FormData(form);

    for (const [key, value] of data.entries()) {
      const text = String(value).trim();
      if (!text || text === "ALL" || text === "all") continue;
      params.append(key, text);
    }

    setIsTyping(false);
    startTransition(() => {
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
    });
  }

  function handleChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    apply(event.currentTarget);
  }

  function handleInput(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") return;
    if (timer.current) clearTimeout(timer.current);
    setIsTyping(true);
    const form = event.currentTarget;
    timer.current = setTimeout(() => apply(form), INPUT_DEBOUNCE_MS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(event.currentTarget);
  }

  return (
    <form className={className} style={style} onChange={handleChange} onInput={handleInput} onSubmit={handleSubmit}>
      {children}
      <div className={`auto-filter-status ${isPending || isTyping ? "active" : ""}`} aria-live="polite">
        <span className="route-spinner" aria-hidden="true" />
        Применяем
      </div>
    </form>
  );
}
