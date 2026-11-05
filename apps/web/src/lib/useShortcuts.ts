import { useEffect } from "react";

export const isMac = navigator.platform.toLowerCase().includes("mac");
export const modKey = isMac ? "⌘" : "Ctrl";

/** Registers global keyboard shortcuts written like "mod+k" or "mod+shift+o". */
export function useShortcuts(map: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const parts = [
        e.metaKey || e.ctrlKey ? "mod" : "",
        e.shiftKey ? "shift" : "",
        e.altKey ? "alt" : "",
        e.key.toLowerCase(),
      ].filter(Boolean);
      const handler = map[parts.join("+")];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}
