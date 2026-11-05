import type { BudgetUnit } from "./schemas.ts";

/**
 * Pure usage/budget rules shared by server and web: billing periods, cost math and budget
 * resolution. No I/O here so the rules are easy to test and impossible to drift between sides.
 */

/** Billing months follow Indonesian time (WIB, UTC+7, no DST), not UTC. */
export const BILLING_UTC_OFFSET_HOURS = 7;
const HOUR_MS = 3_600_000;

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" for the billing month that contains `date`. */
export function periodOf(date: Date): string {
  const shifted = new Date(date.getTime() + BILLING_UTC_OFFSET_HOURS * HOUR_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Half-open UTC range [start, end) of a billing month. */
export function periodRange(period: string): { start: Date; end: Date } {
  if (!PERIOD_PATTERN.test(period)) throw new Error(`Invalid period: ${period}`);
  const [year, month] = period.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(year, month - 1, 1) - BILLING_UTC_OFFSET_HOURS * HOUR_MS);
  const end = new Date(Date.UTC(year, month, 1) - BILLING_UTC_OFFSET_HOURS * HOUR_MS);
  return { start, end };
}

/** Model prices are USD per million tokens, which is exactly micro-USD per token. */
export function costMicroUsd(
  usage: { inputTokens: number; outputTokens: number },
  price: { inputUsdPerMtok: number; outputUsdPerMtok: number },
): number {
  return Math.round(usage.inputTokens * price.inputUsdPerMtok + usage.outputTokens * price.outputUsdPerMtok);
}

export function microUsdToIdr(micro: number, fxUsdIdr: number): number {
  return Math.round((micro / 1_000_000) * fxUsdIdr);
}

export const DEFAULT_FX_USD_IDR = 16_000;

export interface BudgetRule {
  id: string;
  userId: string | null;
  projectId: string | null;
  unit: BudgetUnit;
  limit: number;
}

/**
 * Budgets that apply to one user. A user-specific budget overrides the org-wide default that
 * has the same project and unit; everything else from the default still applies.
 */
export function resolveBudgets<T extends BudgetRule>(budgets: T[], userId: string): T[] {
  const key = (b: BudgetRule) => `${b.projectId ?? "*"}|${b.unit}`;
  const own = budgets.filter((b) => b.userId === userId);
  const overridden = new Set(own.map(key));
  const defaults = budgets.filter((b) => b.userId === null && !overridden.has(key(b)));
  return [...own, ...defaults];
}

export interface BudgetCheck {
  remaining: number;
  /** 0–100+, share of the limit already used. */
  percent: number;
  exceeded: boolean;
}

export function checkBudget(limit: number, used: number): BudgetCheck {
  const remaining = limit - used;
  return {
    remaining: Math.max(0, remaining),
    percent: limit > 0 ? Math.round((used / limit) * 100) : 100,
    exceeded: used >= limit,
  };
}
