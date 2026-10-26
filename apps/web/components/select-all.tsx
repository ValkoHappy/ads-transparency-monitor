"use client";

export function SelectAllCheckbox({ targetName }: { targetName: string }) {
  return (
    <input
      aria-label="Выбрать все"
      type="checkbox"
      onChange={(event) => {
        document.querySelectorAll<HTMLInputElement>(`input[name="${targetName}"]`).forEach((input) => {
          input.checked = event.currentTarget.checked;
        });
      }}
    />
  );
}
