import type { Engine, EngineOption } from "@orbs/protocol";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, Cpu, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";

function sameEngine(a: Engine, b: Engine) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const icons = { auto: Sparkles, model: Cpu, agent: Bot } as const;
const groups = [
  { kind: "auto", title: "engine.group.auto" },
  { kind: "model", title: "engine.group.model" },
  { kind: "agent", title: "engine.group.agent" },
] as const;

/** "Mesin" picker: Auto router, a specific model, or an external agent via harness adapter. */
export function EnginePicker({ value, onChange }: { value: Engine; onChange: (engine: Engine) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const { data } = useQuery(orpc.engines.list.queryOptions());
  const options = data?.options ?? [];
  const current = options.find((o) => sameEngine(o.engine, value));
  const Icon = icons[value.kind];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium hover:bg-muted"
      >
        <Icon className="size-3.5 text-primary" />
        {t("engine.current", { name: current?.label ?? t("engine.autoName") })}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-10 left-0 z-20 w-80 rounded-xl border border-border bg-card p-2 shadow-lg">
          {groups.map((group) => {
            const items = options.filter((o) => o.engine.kind === group.kind);
            if (items.length === 0) return null;
            return (
              <div key={group.kind} className="py-1">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(group.title)}
                </p>
                {items.map((option: EngineOption) => (
                  <button
                    type="button"
                    key={JSON.stringify(option.engine)}
                    disabled={!option.available && option.engine.kind !== "auto"}
                    onClick={() => {
                      onChange(option.engine);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full rounded-lg px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
                      sameEngine(option.engine, value) && "bg-accent",
                    )}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.reason ?? option.description}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
