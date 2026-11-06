/** Needs DATABASE_URL and ORBS_SECRET_KEY: `pnpm --filter @orbs/server test:integration`. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL && process.env.ORBS_SECRET_KEY);

describe.skipIf(!enabled)("model providers", () => {
  let mp: typeof import("./modelProviders.ts");
  let dbm: typeof import("./db.ts");
  let schema: typeof import("@orbs/db").schema;
  let eq: typeof import("drizzle-orm").eq;
  /** A real credential may already be stored here; it is set aside and put back untouched. */
  let saved: Array<typeof import("@orbs/db").schema.modelProvider.$inferSelect> = [];
  const userId = `test-admin-${randomBytes(4).toString("hex")}`;
  const ok = async () => ({ ok: true as const });
  const bad = async () => ({ ok: false as const, error: "API key not valid." });

  beforeAll(async () => {
    mp = await import("./modelProviders.ts");
    dbm = await import("./db.ts");
    ({ schema } = await import("@orbs/db"));
    ({ eq } = await import("drizzle-orm"));
    await dbm.db.insert(schema.user).values({ id: userId, name: "t", email: `${userId}@test.invalid` });
    saved = await dbm.db
      .select()
      .from(schema.modelProvider)
      .where(eq(schema.modelProvider.provider, "gemini"));
    await dbm.db.delete(schema.modelProvider).where(eq(schema.modelProvider.provider, "gemini"));
  });
  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.delete(schema.modelProvider).where(eq(schema.modelProvider.provider, "gemini"));
    await dbm.db.delete(schema.auditLog).where(eq(schema.auditLog.actorId, userId));
    await dbm.db.delete(schema.user).where(eq(schema.user.id, userId));
    if (saved.length > 0) await dbm.db.insert(schema.modelProvider).values(saved);
  });

  it("starts not configured", async () => {
    const g = (await mp.listProviders()).find((p) => p.provider === "gemini");
    expect(g).toMatchObject({ configured: false, status: "not_configured", keyHint: null });
  });

  it("requires a key the first time", async () => {
    await expect(
      mp.saveProvider(
        userId,
        { provider: "gemini", name: "Main", projectName: "p", projectNumber: "99" },
        ok,
      ),
    ).rejects.toMatchObject({
      code: "key_required",
    });
    await expect(
      mp.saveProvider(
        userId,
        { provider: "nope", name: "x", apiKey: "k", projectName: "p", projectNumber: "99" },
        ok,
      ),
    ).rejects.toMatchObject({
      code: "unknown_provider",
    });
  });

  it("saves encrypted, checks the key, and reports connected without ever returning the key", async () => {
    const status = await mp.saveProvider(
      userId,
      {
        provider: "gemini",
        name: "Main",
        apiKey: "AIza-super-secret-1234",
        projectName: "p",
        projectNumber: "99",
      },
      ok,
    );
    expect(status).toMatchObject({
      status: "connected",
      name: "Main",
      keyHint: "1234",
      projectName: "p",
      projectNumber: "99",
    });
    expect(JSON.stringify(status)).not.toContain("super-secret");
    const [row] = await dbm.db
      .select()
      .from(schema.modelProvider)
      .where(eq(schema.modelProvider.provider, "gemini"));
    expect(row?.apiKeyEnc.startsWith("v1.")).toBe(true);
    expect(row?.apiKeyEnc).not.toContain("super-secret");
  });

  it("keeps the stored key when the field is left blank, and re-checks it", async () => {
    let checked = "";
    const status = await mp.saveProvider(
      userId,
      { provider: "gemini", name: "Renamed", projectName: "p", projectNumber: "99" },
      async (key) => {
        checked = key;
        return { ok: true };
      },
    );
    expect(checked).toBe("AIza-super-secret-1234");
    expect(status).toMatchObject({ name: "Renamed", keyHint: "1234", status: "connected" });
  });

  it("marks the provider failed when the key is rejected, and recovers on a good test", async () => {
    const failed = await mp.saveProvider(
      userId,
      {
        provider: "gemini",
        name: "Renamed",
        apiKey: "AIza-other-5678",
        projectName: "p",
        projectNumber: "99",
      },
      bad,
    );
    expect(failed).toMatchObject({ status: "failed", lastError: "API key not valid.", keyHint: "5678" });
    const again = await mp.testProvider(userId, "gemini", ok);
    expect(again).toMatchObject({ status: "connected", lastError: null });
  });

  it("reports the live state: a key that stops working flips to failed, and recovers", async () => {
    await mp.saveProvider(
      userId,
      { provider: "gemini", name: "Live", apiKey: "AIza-live-9999", projectName: "p", projectNumber: "99" },
      ok,
    );
    const later = Date.now() + 60_000; // past the reuse window
    const revoked = await mp.checkProviders(bad, later);
    expect(revoked.find((p) => p.provider === "gemini")).toMatchObject({
      status: "failed",
      lastError: "API key not valid.",
    });
    const restored = await mp.checkProviders(ok, later + 60_000);
    expect(restored.find((p) => p.provider === "gemini")).toMatchObject({
      status: "connected",
      lastError: null,
    });
  });

  it("reuses a very recent check instead of calling the provider again", async () => {
    let calls = 0;
    const counting = async () => {
      calls++;
      return { ok: true as const };
    };
    const base = Date.now() + 200_000;
    await mp.checkProviders(counting, base);
    const before = calls;
    await mp.checkProviders(counting, base + 1_000);
    expect(calls).toBe(before);
    await mp.checkProviders(counting, base + 30_000);
    expect(calls).toBe(before + 1);
  });

  it("removes it and audits without secrets", async () => {
    await mp.removeProvider(userId, "gemini");
    expect((await mp.listProviders()).find((p) => p.provider === "gemini")?.configured).toBe(false);
    await expect(mp.testProvider(userId, "gemini", ok)).rejects.toMatchObject({ code: "not_configured" });
    const audits = await dbm.db.select().from(schema.auditLog).where(eq(schema.auditLog.actorId, userId));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["system.provider.set", "system.provider.test", "system.provider.remove"]),
    );
    expect(JSON.stringify(audits)).not.toMatch(/super-secret|other-5678/);
  });
});
