import { getLang, localeOf } from "../i18n/index.ts";

// Numbers follow the interface language (1,234 in English, 1.234 in Indonesian).
export const num = (n: number) => Math.round(n).toLocaleString(localeOf(getLang()));
export const idr = (n: number) => `Rp ${num(n)}`;

/** Dollars from millionths of a dollar. Amounts under a cent keep four decimals so they don't all read $0.00. */
export function usd(micro: number): string {
  const value = micro / 1_000_000;
  const maxDigits = value > 0 && value < 0.01 ? 4 : 2;
  return `$${value.toLocaleString(localeOf(getLang()), { minimumFractionDigits: 2, maximumFractionDigits: maxDigits })}`;
}
