import { useCallback, useSyncExternalStore } from "react";
import { type MessageKey, messages } from "./messages.ts";

/**
 * Two interface languages: English (default) and Indonesian. The choice is stored per browser
 * (like the theme) and sent to the server in `x-orbs-lang` so server messages match.
 */
export type Lang = "en" | "id";
export type { MessageKey };

export const LANGUAGES: Array<{ id: Lang; label: string }> = [
  { id: "en", label: "English" },
  { id: "id", label: "Bahasa Indonesia" },
];

export const LANG_HEADER = "x-orbs-lang";
const KEY = "orbs:lang";
const DEFAULT_LANG: Lang = "en";
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "id" || saved === "en" ? saved : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

let current: Lang = read();
document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this session only.
  }
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

type Params = Record<string, string | number>;

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const text: string = messages[lang][key] ?? messages.en[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** Translates outside React (module-level code, event handlers) using the current language. */
export function t(key: MessageKey, params?: Params): string {
  return translate(current, key, params);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLang() {
  const lang = useSyncExternalStore(subscribe, () => current);
  return { lang, setLang };
}

/** Translator bound to the active language; components re-render when it changes. */
export function useT() {
  const { lang } = useLang();
  return useCallback((key: MessageKey, params?: Params) => translate(lang, key, params), [lang]);
}

/** BCP 47 locale used for dates and numbers. */
export function localeOf(lang: Lang) {
  return lang === "id" ? "id-ID" : "en-US";
}

export function useLocale() {
  return localeOf(useLang().lang);
}

/** Localized label for a company role ("org.admin" / "org.member"). */
export function useRoleLabel() {
  const t = useT();
  return useCallback(
    (role: string) =>
      role === "org.admin" ? t("common.admin") : role === "org.member" ? t("common.member") : role,
    [t],
  );
}
