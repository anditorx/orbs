/** Needs DATABASE_URL and ORBS_SECRET_KEY: run it against a scratch database (see README). Cleans up after itself. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL && process.env.ORBS_SECRET_KEY);
const TOO_LONG = /Too long|Terlalu panjang/;

describe.skipIf(!enabled)("the room an instruction has in the prompt", () => {
  let mod: typeof import("./customizations.ts");
  let dbm: typeof import("../db.ts");
  let schema: typeof import("@orbs/db").schema;
  let orm: typeof import("drizzle-orm");
  let limits: typeof import("@orbs/protocol");
  const tag = randomBytes(4).toString("hex");
  const org = `room-org-${tag}`;
  const [admin, alice, bob] = [`admin-${tag}`, `alice-${tag}`, `bob-${tag}`];
  const project = `room-project-${tag}`;

  const draft = (over: Record<string, unknown> = {}) => ({
    id: undefined as string | undefined,
    scope: "user" as "user" | "org",
    appliesTo: "all" as "all" | "all_projects" | "projects",
    projectIds: [] as string[],
    ownerId: alice as string | null,
    enabled: true,
    name: "n",
    body: "x",
    ...over,
  });
  const problem = async (d: ReturnType<typeof draft>) => {
    try {
      await mod.assertInstructionRoom(org, d);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const save = (v: Record<string, unknown>) =>
    dbm.db
      .insert(schema.customization)
      .values({ orgId: org, kind: "instruction", name: "saved", ...v } as never);

  beforeAll(async () => {
    mod = await import("./customizations.ts");
    dbm = await import("../db.ts");
    orm = await import("drizzle-orm");
    limits = await import("@orbs/protocol");
    ({ schema } = await import("@orbs/db"));
    await dbm.db.insert(schema.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
    for (const id of [admin, alice, bob])
      await dbm.db.insert(schema.user).values({ id, name: id, email: `${id}@test.invalid` });
    await dbm.db.insert(schema.project).values({ id: project, orgId: org, name: "P", createdBy: admin });
  });

  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.delete(schema.customization).where(orm.eq(schema.customization.orgId, org));
    await dbm.db.delete(schema.project).where(orm.eq(schema.project.id, project));
    for (const id of [admin, alice, bob]) await dbm.db.delete(schema.user).where(orm.eq(schema.user.id, id));
    await dbm.db.delete(schema.organization).where(orm.eq(schema.organization.id, org));
  });

  it("accepts an instruction that fits, and refuses one that doesn't, saying how much it would take", async () => {
    expect(await problem(draft({ body: "x".repeat(100) }))).toBeNull();
    const message = await problem(draft({ body: "x".repeat(limits.INSTRUCTION_LIMIT.user + 1) }));
    expect(message).toMatch(TOO_LONG);
    expect(message).toContain(String(limits.INSTRUCTION_LIMIT.user));
  });

  it("counts what the person already saved, but not other people's, nor the workspace's", async () => {
    const big = "x".repeat(limits.INSTRUCTION_LIMIT.user - 100);
    await save({ scope: "user", ownerId: alice, body: big });
    await save({ scope: "user", ownerId: bob, body: big });
    await save({ scope: "org", ownerId: admin, body: big });
    expect(await problem(draft({ body: "y".repeat(300) }))).toMatch(TOO_LONG);
    expect(await problem(draft({ ownerId: bob, body: "y".repeat(10) }))).toBeNull();
    expect(await problem(draft({ ownerId: "someone-new", body: "y".repeat(300) }))).toBeNull();
  });

  it("gives the workspace and a project each their own room", async () => {
    // The workspace level already holds 2,400 of its 3,000 characters, so 1,000 more doesn't fit there...
    expect(await problem(draft({ scope: "org", ownerId: admin, body: "y".repeat(1_000) }))).toMatch(TOO_LONG);
    // ...but it fits in a project, whose room is separate.
    expect(
      await problem(
        draft({
          scope: "org",
          ownerId: admin,
          appliesTo: "projects",
          projectIds: [project],
          body: "y".repeat(1_000),
        }),
      ),
    ).toBeNull();
  });

  it("lets an instruction be edited without counting its old self, and switched off even when over", async () => {
    const [mine] = await dbm.db
      .select()
      .from(schema.customization)
      .where(orm.and(orm.eq(schema.customization.orgId, org), orm.eq(schema.customization.ownerId, alice)));
    expect(mine).toBeDefined();
    const edited = draft({ id: mine?.id, body: "y".repeat(limits.INSTRUCTION_LIMIT.user - 50) });
    expect(await problem(edited)).toBeNull();
    const off = draft({ enabled: false, body: "z".repeat(limits.INSTRUCTION_LIMIT.user * 3) });
    expect(await problem(off)).toBeNull();
  });

  it("removes what was limited to a project that is gone, and keeps what still has another project", async () => {
    const [gone, kept] = [`gone-${tag}`, `kept-${tag}`];
    await dbm.db.insert(schema.project).values([
      { id: gone, orgId: org, name: "Gone", createdBy: admin },
      { id: kept, orgId: org, name: "Kept", createdBy: admin },
    ]);
    const rows = await dbm.db
      .insert(schema.customization)
      .values([
        {
          orgId: org,
          kind: "instruction",
          scope: "org",
          appliesTo: "projects",
          name: "only-gone",
          body: "x",
        },
        { orgId: org, kind: "instruction", scope: "org", appliesTo: "projects", name: "both", body: "x" },
        { orgId: org, kind: "instruction", scope: "org", appliesTo: "all", name: "everywhere", body: "x" },
      ])
      .returning({ id: schema.customization.id, name: schema.customization.name });
    const idOf = (name: string) => (rows.find((r) => r.name === name) as { id: string }).id;
    await dbm.db.insert(schema.customizationProject).values([
      { customizationId: idOf("only-gone"), projectId: gone },
      { customizationId: idOf("both"), projectId: gone },
      { customizationId: idOf("both"), projectId: kept },
    ]);
    await dbm.db.delete(schema.project).where(orm.eq(schema.project.id, gone));
    await mod.removeOrphanedCustomizations(org);
    const left = await dbm.db
      .select({ name: schema.customization.name })
      .from(schema.customization)
      .where(
        orm.inArray(
          schema.customization.id,
          rows.map((r) => r.id),
        ),
      );
    expect(left.map((r) => r.name).sort()).toEqual(["both", "everywhere"]);
    await dbm.db.delete(schema.project).where(orm.eq(schema.project.id, kept));
  });

  it("tells who wrote each instruction that applies, and which projects it is limited to", async () => {
    const proj = `shown-${tag}`;
    await dbm.db.insert(schema.project).values({ id: proj, orgId: org, name: "Shown", createdBy: admin });
    const rows = await dbm.db
      .insert(schema.customization)
      .values([
        {
          orgId: org,
          ownerId: admin,
          kind: "instruction",
          scope: "org",
          appliesTo: "projects",
          name: "limited",
          body: "x",
        },
        {
          orgId: org,
          ownerId: bob,
          kind: "instruction",
          scope: "user",
          appliesTo: "all",
          name: "bobs",
          body: "x",
        },
        {
          orgId: org,
          ownerId: alice,
          kind: "instruction",
          scope: "user",
          appliesTo: "all",
          name: "alices",
          body: "x",
        },
      ])
      .returning({ id: schema.customization.id, name: schema.customization.name });
    const limited = (rows.find((r) => r.name === "limited") as { id: string }).id;
    await dbm.db.insert(schema.customizationProject).values({ customizationId: limited, projectId: proj });
    const instr = await import("../agent/instructions.ts");

    const inside = await instr.activeInstructions(org, alice, proj);
    const found = inside.find((i) => i.name === "limited");
    expect(found).toMatchObject({ tier: "project", scope: "org", projectNames: ["Shown"], ownerName: admin });
    expect(inside.map((i) => i.name)).toContain("alices");
    expect(inside.map((i) => i.name)).not.toContain("bobs"); // someone else's own instruction is never shown

    const outside = await instr.activeInstructions(org, alice, null);
    expect(outside.map((i) => i.name)).not.toContain("limited");
    await dbm.db.delete(schema.project).where(orm.eq(schema.project.id, proj));
  });

  it("doesn't count an instruction with no text as active", async () => {
    const [empty] = await dbm.db
      .insert(schema.customization)
      .values({
        orgId: org,
        ownerId: admin,
        kind: "instruction",
        scope: "org",
        appliesTo: "all",
        name: "blank",
        body: "  ",
      })
      .returning({ id: schema.customization.id });
    const instr = await import("../agent/instructions.ts");
    expect((await instr.activeInstructions(org, alice, null)).map((i) => i.name)).not.toContain("blank");
    await dbm.db
      .delete(schema.customization)
      .where(orm.eq(schema.customization.id, (empty as { id: string }).id));
  });
});
