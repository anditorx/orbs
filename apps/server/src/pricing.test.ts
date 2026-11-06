import { describe, expect, it } from "vitest";
import { assertPriceNotBelowProvider } from "./pricing.ts";

describe("assertPriceNotBelowProvider", () => {
  it("lets the provider's price and higher through", () => {
    expect(() => assertPriceNotBelowProvider("gemini", "gemini-2.5-flash-lite", 0.1, 0.4)).not.toThrow();
    expect(() => assertPriceNotBelowProvider("gemini", "gemini-2.5-flash-lite", 1, 2)).not.toThrow();
  });

  it("refuses a lower input or output price with the minimum in the message", () => {
    expect(() => assertPriceNotBelowProvider("gemini", "gemini-2.5-flash-lite", 0.05, 0.4)).toThrow(
      /\$0\.10/,
    );
    expect(() => assertPriceNotBelowProvider("gemini", "gemini-2.5-flash-lite", 0.1, 0.2)).toThrow(/\$0\.40/);
  });

  it("refuses an empty price on a model with a known price", () => {
    expect(() => assertPriceNotBelowProvider("gemini", "gemini-2.5-flash-lite", null, null)).toThrow();
  });

  it("leaves a model with no known price alone", () => {
    expect(() => assertPriceNotBelowProvider("gemini", "gemini-9-ultra", null, null)).not.toThrow();
  });
});
