import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "./button.tsx";
import { Input } from "./input.tsx";

/** Asks for one line of text (new project name, rename, ...). */
export function PromptDialog({
  open,
  title,
  label,
  initialValue = "",
  confirmLabel = "Simpan",
  inputType = "text",
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  inputType?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setValue(initialValue);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialValue]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/30"
    >
      <form onSubmit={submit}>
        <h2 className="text-base font-semibold">{title}</h2>
        <Input
          className="mt-4"
          type={inputType}
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Batal
          </Button>
          <Button type="submit" disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
