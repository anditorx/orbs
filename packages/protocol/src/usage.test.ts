import { describe, expect, it } from "vitest";
import {
  type BudgetRule,
  checkBudget,
  costMicroUsd,
  microUsdToIdr,
  periodOf,
  periodRange,
  resolveBudgets,
} from "./usage.ts";

describe("billing period (WIB)", () => {
  it("rolls over at midnight WIB, not UTC", () => {
    // 2026-10-31 17:00 UTC is already 2026-11-01 00:00 in WIB.
    expect(periodOf(new Date("2026-10-31T16:59:59Z"))).toBe("2026-10");
    expect(periodOf(new Date("2026-10-31T17:00:00Z"))).toBe("2026-11");
  });
  it("returns a half-open UTC range", () => {
    const { start, end } = periodRange("2026-11");
    expect(start.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-30T17:00:00.000Z");
  });
  it("handles year rollover and rejects bad input", () => {
    expect(periodRange("2026-12").end.toISOString()).toBe("2026-12-31T17:00:00.000Z");
    expect(() => periodRange("2026-13")).toThrow();
  });
});

describe("cost math", () => {
  it("uses USD per Mtok as micro-USD per token", () => {
    // 1,000 in @ $3/Mtok + 500 out @ $15/Mtok = $0.003 + $0.0075 = $0.0105
    expect(
      costMicroUsd({ inputTokens: 1000, outputTokens: 500 }, { inputUsdPerMtok: 3, outputUsdPerMtok: 15 }),
    ).toBe(10_500);
  });
  it("converts to whole rupiah", () => {
    expect(microUsdToIdr(10_500, 16_000)).toBe(168);
    expect(microUsdToIdr(0, 16_000)).toBe(0);
  });
});

describe("resolveBudgets", () => {
  const rule = (
    id: string,
    userId: string | null,
    projectId: string | null,
    unit: "tokens" | "idr",
    limit: number,
  ) => ({ id, userId, projectId, unit, limit }) satisfies BudgetRule;
  it("lets a user budget override the org default with the same project and unit", () => {
    const all = [
      rule("default", null, null, "idr", 100),
      rule("mine", "u1", null, "idr", 500),
      rule("default-tokens", null, null, "tokens", 1000),
      rule("other", "u2", null, "idr", 1),
    ];
    const ids = resolveBudgets(all, "u1").map((b) => b.id);
    expect(ids).toContain("mine");
    expect(ids).toContain("default-tokens");
    expect(ids).not.toContain("default");
    expect(ids).not.toContain("other");
  });
  it("keeps project-scoped defaults separate from global ones", () => {
    const all = [rule("g", null, null, "idr", 100), rule("p", null, "proj", "idr", 50)];
    expect(resolveBudgets(all, "u1")).toHaveLength(2);
  });
});

describe("checkBudget", () => {
  it("reports remaining and exceeded", () => {
    expect(checkBudget(1000, 250)).toEqual({ remaining: 750, percent: 25, exceeded: false });
    expect(checkBudget(1000, 1000)).toEqual({ remaining: 0, percent: 100, exceeded: true });
    expect(checkBudget(1000, 1500)).toEqual({ remaining: 0, percent: 150, exceeded: true });
  });
});
