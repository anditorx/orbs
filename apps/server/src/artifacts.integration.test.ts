/**
 * Needs DATABASE_URL and ORBS_SECRET_KEY: run it against a scratch database (see README), never your real one.
 * Creates its own organization and people and removes them afterwards.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL && process.env.ORBS_SECRET_KEY);

describe.skipIf(!enabled)("dashboards saved for a conversation", () => {
  let svc: typeof import("./artifacts.ts");
  let dbm: typeof import("./db.ts");
  let schema: typeof import("@orbs/db").schema;
  let orm: typeof import("drizzle-orm");
  const tag = randomBytes(4).toString("hex");
  const org = `art-org-${tag}`;
  const [alice, bob] = [`alice-${tag}`, `bob-${tag}`];
  const threads: string[] = [];
  const page = (body = "<p>hi</p>") => `<!doctype html><html><body>${body}</body></html>`;

  async function newThread(userId = alice) {
    const [row] = await dbm.db
      .insert(schema.thread)
      .values({ orgId: org, title: "t", createdBy: userId })
      .returning({ id: schema.thread.id });
    const id = (row as { id: string }).id;
    threads.push(id);
    return id;
  }

  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return e instanceof svc.ArtifactError ? e.message : `other: ${String(e)}`;
    }
  };

  beforeAll(async () => {
    svc = await import("./artifacts.ts");
    dbm = await import("./db.ts");
    orm = await import("drizzle-orm");
    ({ schema } = await import("@orbs/db"));
    await dbm.db.insert(schema.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
    for (const id of [alice, bob])
      await dbm.db.insert(schema.user).values({ id, name: id, email: `${id}@test.invalid` });
  });

  afterAll(async () => {
    if (!dbm) return;
    for (const id of threads) {
      await dbm.db.delete(schema.event).where(orm.eq(schema.event.streamId, id));
      await dbm.db.delete(schema.thread).where(orm.eq(schema.thread.id, id)); // artifacts go with it
    }
    for (const id of [alice, bob]) await dbm.db.delete(schema.user).where(orm.eq(schema.user.id, id));
    await dbm.db.delete(schema.organization).where(orm.eq(schema.organization.id, org));
  });

  it("saves a page as version 1, then each change as the next version, keeping the old ones", async () => {
    const t = await newThread();
    const first = await svc.saveArtifact({
      orgId: org,
      threadId: t,
      userId: alice,
      title: "Sales",
      html: page("<p>one</p>"),
    });
    expect(first).toMatchObject({ version: 1, title: "Sales" });
    const second = await svc.saveArtifact({
      orgId: org,
      threadId: t,
      userId: alice,
      artifactId: first.artifactId,
      html: page("<p>two</p>"),
    });
    expect(second).toMatchObject({ artifactId: first.artifactId, version: 2, title: "Sales" });
    const [summary] = await svc.listArtifacts(org, alice, t);
    expect(summary).toMatchObject({ id: first.artifactId, title: "Sales", version: 2 });
    expect(summary?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await svc.getArtifact(org, alice, first.artifactId))?.html).toContain("two");
    expect((await svc.getArtifact(org, alice, first.artifactId, 1))?.html).toContain("one");
    expect(await svc.getArtifact(org, alice, first.artifactId, 9)).toBeNull();
  });

  it("can rename a page when changing it", async () => {
    const t = await newThread();
    const a = await svc.saveArtifact({ orgId: org, threadId: t, userId: alice, title: "Old", html: page() });
    await svc.saveArtifact({
      orgId: org,
      threadId: t,
      userId: alice,
      artifactId: a.artifactId,
      title: "New",
      html: page(),
    });
    expect((await svc.listArtifacts(org, alice, t))[0]?.title).toBe("New");
  });

  it("announces each save in the conversation, with no author", async () => {
    const t = await newThread();
    const a = await svc.saveArtifact({
      orgId: org,
      threadId: t,
      userId: alice,
      title: "Sales",
      html: page(),
      turnId: "turn-1",
    });
    await svc.saveArtifact({
      orgId: org,
      threadId: t,
      userId: alice,
      artifactId: a.artifactId,
      html: page("<p>2</p>"),
    });
    const events = await dbm.db
      .select()
      .from(schema.event)
      .where(orm.and(orm.eq(schema.event.streamId, t), orm.eq(schema.event.type, "artifact.saved")))
      .orderBy(orm.asc(schema.event.seq));
    expect(events.map((e) => (e.payload as { version: number; created: boolean }).version)).toEqual([1, 2]);
    expect(events.map((e) => (e.payload as { created: boolean }).created)).toEqual([true, false]);
    expect(events[0]?.actorId).toBeNull();
    expect(events[0]?.payload).toMatchObject({ turnId: "turn-1" });
  });

  it("belongs to the conversation's owner alone", async () => {
    const t = await newThread();
    const a = await svc.saveArtifact({
      orgId: org,
      threadId: t,
      userId: alice,
      title: "Private",
      html: page(),
    });
    expect(await svc.getArtifact(org, bob, a.artifactId)).toBeNull();
    expect(await refusal(svc.listArtifacts(org, bob, t))).toMatch(/not found/);
    expect(
      await refusal(svc.saveArtifact({ orgId: org, threadId: t, userId: bob, title: "x", html: page() })),
    ).toMatch(/not found/);
    expect(
      await refusal(
        svc.saveArtifact({ orgId: org, threadId: t, userId: bob, artifactId: a.artifactId, html: page() }),
      ),
    ).toMatch(/not found/);
    expect(await svc.getArtifact("another-org", alice, a.artifactId)).toBeNull();
  });

  it("won't change a page that lives in another conversation", async () => {
    const [t1, t2] = [await newThread(), await newThread()];
    const a = await svc.saveArtifact({ orgId: org, threadId: t1, userId: alice, title: "One", html: page() });
    expect(
      await refusal(
        svc.saveArtifact({ orgId: org, threadId: t2, userId: alice, artifactId: a.artifactId, html: page() }),
      ),
    ).toMatch(/no dashboard/);
    expect(
      await refusal(
        svc.saveArtifact({ orgId: org, threadId: t2, userId: alice, artifactId: "nope", html: page() }),
      ),
    ).toMatch(/no dashboard/);
  });

  it("lets the assistant read a page only from the conversation it is in", async () => {
    const [t1, t2] = [await newThread(), await newThread()];
    const a = await svc.saveArtifact({ orgId: org, threadId: t1, userId: alice, title: "One", html: page() });
    expect(await svc.getArtifact(org, alice, a.artifactId, undefined, t1)).not.toBeNull();
    expect(await svc.getArtifact(org, alice, a.artifactId, undefined, t2)).toBeNull();
  });

  it("refuses an empty, untitled or oversized page", async () => {
    const t = await newThread();
    expect(
      await refusal(svc.saveArtifact({ orgId: org, threadId: t, userId: alice, title: "T", html: "  " })),
    ).toMatch(/empty/);
    expect(
      await refusal(svc.saveArtifact({ orgId: org, threadId: t, userId: alice, title: " ", html: page() })),
    ).toMatch(/title/);
    expect(
      await refusal(
        svc.saveArtifact({ orgId: org, threadId: t, userId: alice, title: "T", html: "x".repeat(400_001) }),
      ),
    ).toMatch(/longer/);
    expect(await svc.listArtifacts(org, alice, t)).toEqual([]);
  });

  it("limits how many pages one conversation can hold", async () => {
    const t = await newThread();
    for (let i = 0; i < svc.MAX_ARTIFACTS_PER_THREAD; i++) {
      await svc.saveArtifact({ orgId: org, threadId: t, userId: alice, title: `P${i}`, html: page() });
    }
    expect(
      await refusal(
        svc.saveArtifact({ orgId: org, threadId: t, userId: alice, title: "One too many", html: page() }),
      ),
    ).toMatch(/already has/);
    // Changing one that exists is still fine.
    const [any] = await svc.listArtifacts(org, alice, t);
    await svc.saveArtifact({
      orgId: org,
      threadId: t,
      userId: alice,
      artifactId: any?.id,
      html: page("<p>x</p>"),
    });
  });

  it("goes when the conversation is deleted", async () => {
    const t = await newThread();
    const a = await svc.saveArtifact({ orgId: org, threadId: t, userId: alice, title: "Gone", html: page() });
    await dbm.db.delete(schema.thread).where(orm.eq(schema.thread.id, t));
    expect(await svc.getArtifact(org, alice, a.artifactId)).toBeNull();
    const left = await dbm.db
      .select()
      .from(schema.artifactVersion)
      .where(orm.eq(schema.artifactVersion.artifactId, a.artifactId));
    expect(left).toEqual([]);
  });
});
