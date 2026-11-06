import { describe, expect, it } from "vitest";
import { checkPriceFloor, priceIsSet, pricingPageFor, referencePriceFor } from "./referencePrices.ts";

describe("reference prices", () => {
  it("knows the prices it was given, with where and when they were checked", () => {
    expect(referencePriceFor("gemini", "gemini-2.5-flash-lite")).toMatchObject({
      input: 0.1,
      output: 0.4,
      checked: "2026-11-06",
      url: "https://ai.google.dev/gemini-api/docs/pricing",
    });
    expect(referencePriceFor("gemini", "gemini-3.5-flash-lite")).toMatchObject({ input: 0.3, output: 2.5 });
  });

  it("flags the caveats that make a single number misleading", () => {
    expect(referencePriceFor("gemini", "gemini-2.5-pro")?.noteKey).toBe("ref.note.longPrompts");
    expect(referencePriceFor("gemini", "gemini-embedding-001")).toMatchObject({ input: 0.15, output: null });
  });

  it("never guesses: an unknown model or provider has no reference price", () => {
    expect(referencePriceFor("gemini", "gemini-9-ultra")).toBeUndefined();
    expect(referencePriceFor("someone-else", "gemini-2.5-flash-lite")).toBeUndefined();
  });

  it("still points to the pricing page for models without a saved price", () => {
    expect(pricingPageFor("gemini")).toContain("ai.google.dev");
    expect(pricingPageFor("someone-else")).toBeUndefined();
  });
});

describe("price floor", () => {
  const check = (input: number | null, output: number | null) =>
    checkPriceFloor("gemini", "gemini-2.5-flash-lite", input, output);

  it("accepts the provider's price exactly, and anything higher", () => {
    expect(check(0.1, 0.4)).toEqual({ ok: true });
    expect(check(0.13, 0.52)).toEqual({ ok: true });
    expect(check(5, 20)).toEqual({ ok: true });
  });

  it("rejects an input or output price below the provider's, saying which and what the minimum is", () => {
    expect(check(0.09, 0.4)).toEqual({ ok: false, field: "input", min: 0.1 });
    expect(check(0.1, 0.39)).toEqual({ ok: false, field: "output", min: 0.4 });
  });

  it("treats an empty price as zero, which is below the floor", () => {
    expect(check(null, null)).toEqual({ ok: false, field: "input", min: 0.1 });
    expect(check(0.1, null)).toEqual({ ok: false, field: "output", min: 0.4 });
  });

  it("is not thrown off by floating-point noise", () => {
    expect(check(0.1 + 0.2 - 0.2, 0.4)).toEqual({ ok: true });
  });

  it("asks for no output price on a model that has none, such as embeddings", () => {
    expect(checkPriceFloor("gemini", "gemini-embedding-001", 0.15, null)).toEqual({ ok: true });
    expect(checkPriceFloor("gemini", "gemini-embedding-001", 0.1, null)).toEqual({
      ok: false,
      field: "input",
      min: 0.15,
    });
  });

  it("has no floor for a model it knows no price for (nothing is guessed)", () => {
    expect(checkPriceFloor("gemini", "gemini-9-ultra", null, null)).toEqual({ ok: true });
    expect(checkPriceFloor("other", "x", 0, 0)).toEqual({ ok: true });
  });
});

describe("priceIsSet", () => {
  it("needs a price at or above the published one when there is one", () => {
    expect(priceIsSet("gemini", "gemini-2.5-flash-lite", 0.1, 0.4)).toBe(true);
    expect(priceIsSet("gemini", "gemini-2.5-flash-lite", null, null)).toBe(false);
    expect(priceIsSet("gemini", "gemini-2.5-flash-lite", 0.05, 0.4)).toBe(false);
  });
  it("needs both prices when nothing is published", () => {
    expect(priceIsSet("gemini", "gemini-9-ultra", 1, 2)).toBe(true);
    expect(priceIsSet("gemini", "gemini-9-ultra", 1, null)).toBe(false);
    expect(priceIsSet("gemini", "gemini-9-ultra", null, null)).toBe(false);
  });
});
