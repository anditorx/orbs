/** Needs DATABASE_URL and ORBS_SECRET_KEY: `pnpm --filter @orbs/server test:integration`. Touches only its own rows. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL && process.env.ORBS_SECRET_KEY);

describe.skipIf(!enabled)("model listing and enabling", () => {
  let mp: typeof import("./modelProviders.ts");
  let models: typeof import("./models.ts");
  let dbm: typeof import("./db.ts");
  let schema: typeof import("@orbs/db").schema;
  let orm: typeof import("drizzle-orm");
  const tag = randomBytes(4).toString("hex");
  const orgId = `test-org-${tag}`;
  const userId = `test-admin-${tag}`;
  const modelId = `gemini-test-${tag}`;
  /** A provider of its own, so nothing here can touch the real Gemini credential or models. */
  const testProvider = `test-provider-${tag}`;
  /** A real, decryptable blob: the background check reads it with the vault, exactly as in production. */
  const enc = () => vaultm.vault().encrypt("test-key", vaultm.aad.providerKey(testProvider));
  let vaultm: typeof import("./connectors/vault.ts");
  const list = async () => [
    {
      name: `models/${modelId}`,
      displayName: "Test Model",
      description: "",
      inputTokenLimit: 1,
      outputTokenLimit: 1,
      methods: [],
    },
  ];

  const mine = async () => (await models.modelsForOrg(orgId)).find((m) => m.modelId === modelId);
  const row = async () => {
    const [r] = await dbm.db.select().from(schema.aiModel).where(orm.eq(schema.aiModel.modelId, modelId));
    return r;
  };
  const override = async (assigned: boolean, on: boolean) => {
    const [m] = await dbm.db.select().from(schema.aiModel).where(orm.eq(schema.aiModel.modelId, modelId));
    if (!m) throw new Error("no model");
    // Same rule the admin screen applies.
    if (assigned && on) {
      await dbm.db.delete(schema.orgModel).where(orm.eq(schema.orgModel.modelRefId, m.id));
    } else {
      const values = { enabled: assigned ? on : true, hidden: !assigned };
      await dbm.db
        .insert(schema.orgModel)
        .values({ orgId, modelRefId: m.id, ...values })
        .onConflictDoUpdate({ target: [schema.orgModel.orgId, schema.orgModel.modelRefId], set: values });
    }
  };

  beforeAll(async () => {
    mp = await import("./modelProviders.ts");
    vaultm = await import("./connectors/vault.ts");
    models = await import("./models.ts");
    dbm = await import("./db.ts");
    orm = await import("drizzle-orm");
    ({ schema } = await import("@orbs/db"));
    await dbm.db
      .insert(schema.organization)
      .values({ id: orgId, name: "T", slug: `t-${tag}`, createdAt: new Date() });
    await dbm.db.insert(schema.user).values({ id: userId, name: "t", email: `${userId}@test.invalid` });
    mp.MODEL_PROVIDERS[testProvider] = { id: testProvider, name: "Test", verify: async () => ({ ok: true }) };
    await dbm.db.insert(schema.modelProvider).values({
      provider: testProvider,
      name: "t",
      apiKeyEnc: enc(),
      keyHint: "x",
      status: "connected",
      billingConfirmed: true,
    });
  });
  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.delete(schema.aiModel).where(orm.eq(schema.aiModel.provider, testProvider));
    await dbm.db.delete(schema.modelProvider).where(orm.eq(schema.modelProvider.provider, testProvider));
    delete mp.MODEL_PROVIDERS[testProvider];
    await dbm.db.delete(schema.auditLog).where(orm.eq(schema.auditLog.actorId, userId));
    await dbm.db.delete(schema.organization).where(orm.eq(schema.organization.id, orgId));
    await dbm.db.delete(schema.user).where(orm.eq(schema.user.id, userId));
  });

  it("only registers models the provider offers, and never enables one that isn't active yet", async () => {
    await expect(
      mp.setProviderModel(userId, { provider: testProvider, modelId: "nope-1", listed: true }, list),
    ).rejects.toMatchObject({ code: "model_not_offered" });
    await expect(
      mp.setProviderModel(userId, { provider: testProvider, modelId, enabled: true }, list),
    ).rejects.toMatchObject({ code: "activate_first" });
    expect(await row()).toBeUndefined();
  });

  it("Active puts the model in every organization's list, with the provider's name for it", async () => {
    await mp.setProviderModel(userId, { provider: testProvider, modelId, listed: true }, list);
    expect(await row()).toMatchObject({ displayName: "Test Model", listed: true, active: true });
    // Without a price its use would be counted as free, so it can't be chosen yet.
    expect(await mine()).toMatchObject({ displayName: "Test Model", available: false, off: "unpriced" });
    await dbm.db
      .update(schema.aiModel)
      .set({ inputUsdPerMtok: "1", outputUsdPerMtok: "4" })
      .where(orm.eq(schema.aiModel.modelId, modelId));
    expect(await mine()).toMatchObject({ displayName: "Test Model", available: true, off: null });
  });

  it("a provider not confirmed as a paid plan keeps its models unavailable, whatever else is on", async () => {
    const set = (billingConfirmed: boolean) =>
      dbm.db
        .update(schema.modelProvider)
        .set({ billingConfirmed })
        .where(orm.eq(schema.modelProvider.provider, testProvider));
    await set(false);
    try {
      expect(await mine()).toMatchObject({ available: false, off: "billing" });
      expect(await models.isModelAvailable(orgId, testProvider, modelId)).toBe(false);
    } finally {
      await set(true);
    }
    expect(await mine()).toMatchObject({ available: true, off: null });
  });

  it("Enable decides whether it can be chosen: off keeps it listed but greyed out", async () => {
    await mp.setProviderModel(userId, { provider: testProvider, modelId, enabled: false }, list);
    expect(await mine()).toMatchObject({ available: false, off: "global" });
    expect(await models.isModelAvailable(orgId, testProvider, modelId)).toBe(false);
    await mp.setProviderModel(userId, { provider: testProvider, modelId, enabled: true }, list);
    expect(await models.isModelAvailable(orgId, testProvider, modelId)).toBe(true);
  });

  it("an organization can hide it or switch it off, and going back to the default clears the override", async () => {
    await override(true, false);
    expect(await mine()).toMatchObject({ available: false, off: "org" });
    await override(false, false);
    expect(await mine()).toBeUndefined();
    await override(true, true);
    expect(await mine()).toMatchObject({ available: true });
    const overrides = await dbm.db.select().from(schema.orgModel).where(orm.eq(schema.orgModel.orgId, orgId));
    expect(overrides).toEqual([]);
  });

  it("names the organizations a model appears in, marking those that switched it off", async () => {
    const orgsOf = async () => {
      const [m] = await dbm.db.select().from(schema.aiModel).where(orm.eq(schema.aiModel.modelId, modelId));
      return (await models.organizationsPerModel()).get(m?.id ?? "") ?? [];
    };
    await override(true, true);
    expect(await orgsOf()).toContainEqual({ id: orgId, name: "T", enabled: true });
    await override(true, false);
    expect(await orgsOf()).toContainEqual({ id: orgId, name: "T", enabled: false });
    await override(false, false);
    expect((await orgsOf()).some((o) => o.id === orgId)).toBe(false);
    await override(true, true);
    await mp.setProviderModel(userId, { provider: testProvider, modelId, listed: false }, list);
    expect(await orgsOf()).toEqual([]);
    await mp.setProviderModel(userId, { provider: testProvider, modelId, listed: true }, list);
  });

  it("making a model inactive removes it from every list but keeps its settings", async () => {
    await mp.setProviderModel(userId, { provider: testProvider, modelId, listed: false }, list);
    expect(await mine()).toBeUndefined();
    expect(await row()).toMatchObject({ listed: false, displayName: "Test Model" });
    await mp.setProviderModel(userId, { provider: testProvider, modelId, listed: true }, list);
    expect(await mine()).toMatchObject({ available: true });
  });

  const setProvider = (status: "connected" | "failed") =>
    dbm.db
      .update(schema.modelProvider)
      .set({ status })
      .where(orm.eq(schema.modelProvider.provider, testProvider));

  it("a provider that isn't connected only dims its models: they stay, settings intact", async () => {
    await mp.setProviderModel(userId, { provider: testProvider, modelId, listed: true }, list);
    await setProvider("failed");
    expect(await mine()).toMatchObject({ available: false, off: "provider", displayName: "Test Model" });
    expect(await models.isModelAvailable(orgId, testProvider, modelId)).toBe(false);
    expect(await row()).toMatchObject({ listed: true, active: true });
    await setProvider("connected");
    expect(await mine()).toMatchObject({ available: true, off: null });
  });

  it("a provider that was never set up dims its models too", async () => {
    await dbm.db.delete(schema.modelProvider).where(orm.eq(schema.modelProvider.provider, testProvider));
    expect(await mine()).toMatchObject({ available: false, off: "provider" });
    await dbm.db.insert(schema.modelProvider).values({
      provider: testProvider,
      name: "t",
      apiKeyEnc: enc(),
      keyHint: "x",
      status: "connected",
      billingConfirmed: true,
    });
  });

  it("a passing failure doesn't dim anything, but three in a row do, and a rejected key does at once", async () => {
    const blip = async () => ({ ok: false as const, error: "Timed out", transient: true });
    const rejected = async () => ({ ok: false as const, error: "API key not valid.", transient: false });
    const good = async () => ({ ok: true as const });
    const statusOf = async () => (await mp.listProviders()).find((p) => p.provider === testProvider)?.status;
    let t = Date.now() + 1_000_000;
    const check = async (v: typeof good | typeof blip | typeof rejected) => {
      t += 60_000;
      await mp.checkProviders(v, t, [testProvider]);
      return statusOf();
    };
    expect(await check(blip)).toBe("connected");
    expect(await check(blip)).toBe("connected");
    expect(await check(good)).toBe("connected"); // a good check resets the count
    expect(await check(blip)).toBe("connected");
    expect(await check(blip)).toBe("connected");
    expect(await check(blip)).toBe("failed");
    expect(await check(good)).toBe("connected");
    expect(await check(rejected)).toBe("failed");
    expect(await mine()).toMatchObject({ available: false, off: "provider" });
    await check(good);
  });

  it("deleting a provider deletes its models and their settings, and only its own", async () => {
    await override(true, false); // an organization override on the test model
    const count = async (provider: string) =>
      (await dbm.db.select().from(schema.aiModel).where(orm.eq(schema.aiModel.provider, provider))).length;
    const otherBefore = await count("gemini");
    expect((await mp.listProviders()).find((p) => p.provider === testProvider)?.modelCount).toBe(1);

    expect(await mp.removeProvider(userId, testProvider)).toEqual({ modelsRemoved: 1 });

    expect(await row()).toBeUndefined();
    expect(await mine()).toBeUndefined();
    const overrides = await dbm.db.select().from(schema.orgModel).where(orm.eq(schema.orgModel.orgId, orgId));
    expect(overrides).toEqual([]);
    const providerRows = await dbm.db
      .select()
      .from(schema.modelProvider)
      .where(orm.eq(schema.modelProvider.provider, testProvider));
    expect(providerRows).toEqual([]);
    expect(await count("gemini")).toBe(otherBefore);
  });
});
