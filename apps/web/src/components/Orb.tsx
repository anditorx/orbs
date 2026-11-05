import { cn } from "../lib/utils.ts";

/** The Orbs mark: a soft gradient sphere (pure CSS, no assets). */
export function Orb({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-7 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--orb-from),var(--orb-via)_55%,var(--orb-to))] shadow-[0_2px_10px_color-mix(in_oklab,var(--orb-via)_45%,transparent)]",
        className,
      )}
    />
  );
}
