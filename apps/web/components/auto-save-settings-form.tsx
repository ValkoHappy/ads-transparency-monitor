"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";

export function AutoSaveSettingsForm({
  action,
  className,
  children
}: {
  action: (formData: FormData) => Promise<void> | void;
  className?: string;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const formData = new FormData(form);
      startTransition(async () => {
        try {
          setError(null);
          await action(formData);
          setSavedAt(new Date());
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : "Ошибка сохранения");
        }
      });
    }, 650);
  }

  return (
    <form ref={formRef} className={className} onChange={scheduleSave} onInput={scheduleSave}>
      <div className={`autosave-status ${error ? "error" : ""}`} aria-live="polite">
        {error ? error : isPending ? "Сохраняем..." : savedAt ? `Сохранено ${savedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Автосохранение включено"}
      </div>
      {children}
    </form>
  );
}
