import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";

export type Tone = "ok" | "warn" | "idle";

const DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  idle: "bg-muted-foreground/40",
};

/** One line in the connections list: logo, name, quiet status, actions, and an expandable details area. */
export function ConnectionRow({
  logo,
  title,
  subtitle,
  status,
  tone,
  actions,
  open,
  onToggle,
  children,
}: {
  logo: ReactNode;
  title: string;
  subtitle?: string;
  status?: string;
  tone?: Tone;
  actions?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <li>
      <div className="flex items-center gap-4 px-5 py-4">
        {logo}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="font-medium">{title}</span>
              {status && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", DOT[tone ?? "idle"])} />
                  {status}
                </span>
              )}
            </span>
            {subtitle && (
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">{subtitle}</span>
            )}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {open && <div className="space-y-5 border-t border-border bg-muted/30 px-5 py-5">{children}</div>}
    </li>
  );
}
