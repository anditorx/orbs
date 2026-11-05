import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest.ts";

describe("parseManifest", () => {
  it("accepts a minimal plugin and fills defaults", () => {
    const result = parseManifest({
      name: "sdlc-agent",
      version: "0.1.0",
      displayName: "SDLC Agent",
      description: "Role-based software delivery workflow",
    });
    expect(result.success).toBe(true);
    expect(result.data?.permissions.shell).toBe(false);
  });

  it("rejects invalid names and versions", () => {
    expect(
      parseManifest({ name: "Bad Name", version: "1", displayName: "x", description: "y" }).success,
    ).toBe(false);
  });
});
