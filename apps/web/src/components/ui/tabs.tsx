import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils.ts";

/** Two or three clearly clickable tabs: bordered buttons, the active one filled with the accent. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ id: T; label: string; icon: LucideIcon }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
            value === id
              ? "border-primary bg-accent font-medium text-primary"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="size-4" /> {label}
        </button>
      ))}
    </div>
  );
}
