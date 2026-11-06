import { Plug, Server } from "lucide-react";
import { cn } from "../lib/utils.ts";

/** Asana's mark: three coral circles. Drawn here so no external image is loaded. */
function AsanaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Asana">
      <title>Asana</title>
      <circle cx="16" cy="9" r="6" fill="#F06A6A" />
      <circle cx="8" cy="22" r="6" fill="#F06A6A" />
      <circle cx="24" cy="22" r="6" fill="#F06A6A" />
    </svg>
  );
}

/** Gemini's four-point sparkle, in its blue-to-violet gradient. */
function GeminiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Gemini">
      <title>Gemini</title>
      <defs>
        <linearGradient id="gemini-gradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="0.55" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C12 7.5 16.5 12 22 12C16.5 12 12 16.5 12 22C12 16.5 7.5 12 2 12C7.5 12 12 7.5 12 2Z"
        fill="url(#gemini-gradient)"
      />
    </svg>
  );
}

/** The service's logo in a rounded tile, or a generic plug when we don't have one. */
export function ProviderLogo({ provider, className }: { provider: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/95 shadow-sm ring-1 ring-border",
        className,
      )}
    >
      {provider === "gemini" ? (
        <GeminiMark className="size-6" />
      ) : provider === "asana" ? (
        <AsanaMark className="size-6" />
      ) : provider === "custom" ? (
        <Server className="size-5 text-primary" />
      ) : (
        <Plug className="size-5 text-primary" />
      )}
    </span>
  );
}
