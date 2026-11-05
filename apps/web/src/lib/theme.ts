import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Accent = "violet" | "lagoon" | "forest" | "sunset";
export interface ThemePreference {
  mode: ThemeMode;
  accent: Accent;
}

export const ACCENTS: Array<{ id: Accent; label: string; swatch: string }> = [
  { id: "violet", label: "Violet", swatch: "#7c3aed" },
  { id: "lagoon", label: "Laguna", swatch: "#0891b2" },
  { id: "forest", label: "Hutan", swatch: "#16a34a" },
  { id: "sunset", label: "Senja", swatch: "#ea580c" },
];

const KEY = "orbs:theme";
const listeners = new Set<() => void>();
let current: ThemePreference = read();

function read(): ThemePreference {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ThemePreference>;
    return { mode: saved.mode ?? "system", accent: saved.accent ?? "violet" };
  } catch {
    return { mode: "system", accent: "violet" };
  }
}

const media = window.matchMedia("(prefers-color-scheme: dark)");

function apply(pref: ThemePreference) {
  const dark = pref.mode === "dark" || (pref.mode === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  if (pref.accent === "violet") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = pref.accent;
}

media.addEventListener("change", () => {
  if (current.mode === "system") apply(current);
});

function setTheme(next: ThemePreference) {
  current = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  apply(next);
  for (const listener of listeners) listener();
}

/** Theme preference shared by every component, persisted per browser. */
export function useTheme() {
  const pref = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  useEffect(() => apply(pref), [pref]);
  const setMode = useCallback((mode: ThemeMode) => setTheme({ ...current, mode }), []);
  const setAccent = useCallback((accent: Accent) => setTheme({ ...current, accent }), []);
  const toggleDark = useCallback(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme({ ...current, mode: isDark ? "light" : "dark" });
  }, []);
  return { ...pref, setMode, setAccent, toggleDark };
}
