import { describe, expect, it } from "vitest";
import { checkSecrets, isPlaceholderSecret } from "./secretsGuard.ts";

describe("secrets that are published in the repository", () => {
  it("recognises the placeholder from .env.example and common stand-ins", () => {
    for (const v of [
      "change-me-in-production-please-32b",
      "CHANGE-ME-abcdefghijklmnopqrstuvwxyz0123",
      "your-secret-here-xxxxxxxxxxxxxxxxxxxx",
    ]) {
      expect(isPlaceholderSecret(v), v).toBe(true);
    }
  });

  it("accepts a generated secret", () => {
    expect(isPlaceholderSecret("q3XmN0cV8d1tZ7rJkE5yWbP2uHfA9sLgT4oRiYxC6vM=")).toBe(false);
    expect(isPlaceholderSecret(undefined)).toBe(false);
  });

  it("refuses to run in production on the placeholder", () => {
    expect(() =>
      checkSecrets({ BETTER_AUTH_SECRET: "change-me-in-production-please-32b" }, "production"),
    ).toThrow(/placeholder/);
  });

  it("only warns in development, and says nothing for a real secret", () => {
    expect(
      checkSecrets({ BETTER_AUTH_SECRET: "change-me-in-production-please-32b" }, "development"),
    ).toHaveLength(1);
    expect(
      checkSecrets({ BETTER_AUTH_SECRET: "change-me-in-production-please-32b" }, undefined),
    ).toHaveLength(1);
    expect(
      checkSecrets({ BETTER_AUTH_SECRET: "q3XmN0cV8d1tZ7rJkE5yWbP2uHfA9sLgT4oRiYxC6vM=" }, "production"),
    ).toEqual([]);
  });
});
