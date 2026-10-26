"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingText?: string;
  children: ReactNode;
};

export function PendingButton({
  children,
  pendingText = "Выполняется",
  className = "button",
  disabled,
  ...props
}: PendingButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      className={`${className} ${pending ? "is-pending" : ""}`}
      disabled={disabled || pending}
    >
      {pending ? (
        <>
          <span className="button-spinner" aria-hidden="true" />
          {pendingText}
        </>
      ) : children}
    </button>
  );
}
