import { describe, expect, it } from "vitest";
import { AdminModelPatch, CustomizationPatch } from "./schemas.ts";

// Regression: `.partial()` of a schema with `.default()` fields re-applies the defaults, so a
// one-field update (toggle) used to overwrite everything else with defaults.
describe("patch schemas keep omitted fields omitted", () => {
  it("customization: toggling enabled changes nothing else", () => {
    expect(CustomizationPatch.parse({ enabled: false })).toEqual({ enabled: false });
  });
  it("model: toggling active changes nothing else", () => {
    expect(AdminModelPatch.parse({ active: false })).toEqual({ active: false });
  });
  it("still validates the fields that are sent", () => {
    expect(() => CustomizationPatch.parse({ name: "" })).toThrow();
    expect(() => AdminModelPatch.parse({ qualityScore: 2 })).toThrow();
    expect(AdminModelPatch.parse({ inputUsdPerMtok: null })).toEqual({ inputUsdPerMtok: null });
  });
});
