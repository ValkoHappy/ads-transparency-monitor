"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icons } from "@/components/icons";

export function DeleteAdvertiserButton({
  advertiserId,
  advertiserName,
  redirectTo
}: {
  advertiserId: string;
  advertiserName: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function removeAdvertiser() {
    if (pending) return;
    const confirmed = window.confirm(`Удалить рекламодателя "${advertiserName}" вместе с креативами и историей сканов?`);
    if (!confirmed) return;

    setPending(true);
    try {
      const response = await fetch(`/api/advertisers/${advertiserId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        window.alert(payload.error ?? "Не удалось удалить рекламодателя.");
        return;
      }

      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      className="icon-button danger"
      disabled={pending}
      onClick={removeAdvertiser}
      title="Удалить рекламодателя"
      type="button"
    >
      <Icons.Trash2 size={16} />
    </button>
  );
}
