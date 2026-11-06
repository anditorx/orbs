/** Needs DATABASE_URL and ORBS_SECRET_KEY: `pnpm --filter @orbs/server test:integration`. Touches only its own rows. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL && process.env.ORBS_SECRET_KEY);

describe.skipIf(!enabled)("usage in dollars, rupiah and tokens", () => {
  let u: typeof import("./usage.ts");
  let dbm: typeof import("./db.ts");
  let schema: typeof import("@orbs/db").schema;
  let orm: typeof import("drizzle-orm");
  const tag = randomBytes(4).toString("hex");
  const provider = `usage-test-${tag}`;
  const orgA = `usage-org-a-${tag}`;
  const orgB = `usage-org-b-${tag}`;
  const [alice, bob, carol] = [`alice-${tag}`, `bob-${tag}`, `carol-${tag}`];
  const flash = `flash-${tag}`;
  const pro = `pro-${tag}`;

  const rec = (orgId: string, userId: string, modelId: string, input: number, output: number) =>
    u.recordUsage({ orgId, userId, provider, modelId, inputTokens: input, outputTokens: output });

  beforeAll(async () => {
    u = await import("./usage.ts");
    dbm = await import("./db.ts");
    orm = await import("drizzle-orm");
    ({ schema } = await import("@orbs/db"));
    const { db } = dbm;
    for (const id of [orgA, orgB])
      await db.insert(schema.organization).values({ id, name: id, slug: id, createdAt: new Date() });
    await db.insert(schema.aiModel).values([
      { provider, modelId: flash, displayName: "Flash", inputUsdPerMtok: "0.30", outputUsdPerMtok: "2.50" },
      { provider, modelId: pro, displayName: "Pro", inputUsdPerMtok: "1.25", outputUsdPerMtok: "10" },
    ]);
    await rec(orgA, alice, flash, 1_000_000, 100_000); // $0.30 + $0.25 = $0.55
    await rec(orgA, alice, pro, 200_000, 50_000); // $0.25 + $0.50 = $0.75
    await rec(orgA, bob, flash, 500_000, 0); // $0.15
    await rec(orgB, carol, pro, 1_000_000, 0); // $1.25
    await rec(orgA, alice, flash, 100_000, 0); // $0.03, then moved to yesterday
    await db.execute(
      orm.sql`update usage_ledger set created_at = created_at - interval '1 day' where id = (select max(id) from usage_ledger where org_id = ${orgA})`,
    );
  });
  afterAll(async () => {
    if (!dbm) return;
    const { db } = dbm;
    for (const id of [orgA, orgB])
      await db.delete(schema.usageLedger).where(orm.eq(schema.usageLedger.orgId, id));
    await db.delete(schema.aiModel).where(orm.eq(schema.aiModel.provider, provider));
    for (const id of [orgA, orgB])
      await db.delete(schema.organization).where(orm.eq(schema.organization.id, id));
  });

  const period = () => u.resolvePeriod(undefined);

  it("totals per person are in tokens, dollars and rupiah, and the rupiah follow the frozen rate", async () => {
    const t = await u.totalsFor(orgA, period(), { userId: alice });
    expect(t.requests).toBe(3);
    expect(t.totalTokens).toBe(1_450_000);
    expect(t.costMicroUsd).toBe(1_330_000); // $1.33
    expect(t.costIdr).toBe(Math.round(1.33 * 16000)); // default rate 16,000
    const bobTotals = await u.totalsFor(orgA, period(), { userId: bob });
    expect(bobTotals.costMicroUsd).toBe(150_000);
  });

  it("the same usage is available per model, per provider and per day", async () => {
    const models = await u.byModel(orgA, period(), { userId: alice });
    expect(models.map((m) => [m.modelId, m.costMicroUsd])).toEqual([
      [pro, 750_000],
      [flash, 580_000],
    ]);
    const providers = await u.byProvider(orgA, period(), { userId: alice });
    expect(providers).toEqual([
      expect.objectContaining({ provider, requests: 3, totalTokens: 1_450_000, costMicroUsd: 1_330_000 }),
    ]);
    const days = await u.byDay(orgA, period(), { userId: alice });
    expect(days).toHaveLength(2);
    expect(days.reduce((n, d) => n + d.costMicroUsd, 0)).toBe(1_330_000);
    expect(days[0]?.costMicroUsd).toBe(30_000); // yesterday: the $0.03 call
  });

  it("the team view carries dollars per person too", async () => {
    const rows = await u.totalsByUser(orgA, period(), null);
    const by = Object.fromEntries(rows.map((r) => [r.userId, r.costMicroUsd]));
    expect(by[alice]).toBe(1_330_000);
    expect(by[bob]).toBe(150_000);
  });

  it("one organization never sees another's usage", async () => {
    expect((await u.totalsFor(orgB, period(), { userId: alice })).requests).toBe(0);
    expect((await u.byProvider(orgB, period())).find((p) => p.provider === provider)?.costMicroUsd).toBe(
      1_250_000,
    );
  });

  it("system administrators see each provider and model across organizations, with how many people used them", async () => {
    const all = await u.usageAcrossOrganizations(period());
    const p = all.byProvider.find((x) => x.provider === provider);
    expect(p).toMatchObject({ requests: 5, costMicroUsd: 1_330_000 + 150_000 + 1_250_000, people: 3 });
    const proRow = all.byModel.find((m) => m.modelId === pro);
    expect(proRow).toMatchObject({ requests: 2, costMicroUsd: 2_000_000, people: 2 });
    expect(all.byModel.find((m) => m.modelId === flash)).toMatchObject({ requests: 3, people: 2 });
  });
});
