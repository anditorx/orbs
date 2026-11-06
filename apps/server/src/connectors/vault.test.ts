import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aad, createVault } from "./vaultCore.ts";

const key = randomBytes(32);

describe("vault", () => {
  it("round-trips a secret", () => {
    const v = createVault(key);
    const blob = v.encrypt("refresh-token-123", "ctx");
    expect(blob).not.toContain("refresh-token-123");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(v.decrypt(blob, "ctx")).toBe("refresh-token-123");
  });

  it("never produces the same ciphertext twice (fresh nonce)", () => {
    const v = createVault(key);
    expect(v.encrypt("same", "ctx")).not.toBe(v.encrypt("same", "ctx"));
  });

  it("refuses to decrypt for a different owner (AAD binding)", () => {
    const v = createVault(key);
    const blob = v.encrypt("token", aad.refreshToken("org1", "userA", "asana"));
    expect(() => v.decrypt(blob, aad.refreshToken("org1", "userB", "asana"))).toThrow();
    expect(() => v.decrypt(blob, aad.accessToken("org1", "userA", "asana"))).toThrow();
  });

  it("detects tampering", () => {
    const v = createVault(key);
    const [version, iv, tag, ct] = v.encrypt("token", "ctx").split(".");
    const flipped = Buffer.from(ct as string, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => v.decrypt([version, iv, tag, flipped.toString("base64url")].join("."), "ctx")).toThrow();
  });

  it("fails with the wrong key and rejects unknown formats", () => {
    const blob = createVault(key).encrypt("token", "ctx");
    expect(() => createVault(randomBytes(32)).decrypt(blob, "ctx")).toThrow();
    expect(() => createVault(key).decrypt("v9.a.b.c", "ctx")).toThrow("Unsupported");
    expect(() => createVault(key).decrypt("garbage", "ctx")).toThrow("Unsupported");
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => createVault(randomBytes(16))).toThrow();
  });
});
