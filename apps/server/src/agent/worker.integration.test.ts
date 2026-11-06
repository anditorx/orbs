/**
 * Needs DATABASE_URL and ORBS_SECRET_KEY: run it against a scratch database (see README), never your real one.
 * Uses a Gemini stand-in and its own provider, organization and people; it removes everything it created.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL && process.env.ORBS_SECRET_KEY);

describe.skipIf(!enabled)("the agent worker", () => {
  let dbm: typeof import("../db.ts");
  let schema: typeof import("@orbs/db").schema;
  let orm: typeof import("drizzle-orm");
  let turns: typeof import("./turns.ts");
  let workerMod: typeof import("./worker.ts");
  let bus: typeof import("./streamBus.ts");
  let modelsMod: typeof import("../models.ts");
  let vaultMod: typeof import("../connectors/vault.ts");
  let mock: Awaited<ReturnType<typeof import("../dev/mockGemini.ts").startMockGemini>>;
  let asana: Awaited<ReturnType<typeof import("../dev/mockAsana.ts").startMockAsana>>;
  let connectors: typeof import("../connectors/service.ts");
  let worker: ReturnType<typeof import("./worker.ts").startWorker>;
  let unsubscribe: () => boolean;

  const tag = randomBytes(4).toString("hex");
  const provider = `chat-${tag}`;
  const org = `chat-org-${tag}`;
  const [alice, bob] = [`alice-${tag}`, `bob-${tag}`];
  const model = `gemini-3-test-${tag}`;
  const ghost = `gemini-2-ghost-${tag}`; // the stand-in answers 404 for this one
  const unpriced = `gemini-3-free-${tag}`;
  const key = `key-${tag}`;
  const threads: string[] = [];
  const seen = new Map<string, string[]>(); // turnId -> streamed pieces

  const auto = { kind: "auto" as const };

  async function newThread(userId = alice, title = "t") {
    const [row] = await dbm.db
      .insert(schema.thread)
      .values({ orgId: org, title, createdBy: userId })
      .returning({ id: schema.thread.id });
    const id = (row as { id: string }).id;
    threads.push(id);
    return id;
  }

  /** Posts a message the way the API does, waits for the reply to end, and returns what happened. */
  async function ask(threadId: string, text: string, engine: unknown = auto, userId = alice) {
    const turnId = await dbm.db.transaction(async (tx) => {
      await tx.insert(schema.event).values({
        orgId: org,
        streamType: "thread",
        streamId: threadId,
        type: "message.posted",
        payload: { role: "user", text },
        actorId: userId,
      });
      return turns.enqueueTurn(tx, { orgId: org, threadId, userId, engine: engine as never });
    });
    turns.wake();
    return { turnId, turn: await settle(turnId) };
  }

  async function settle(turnId: string) {
    for (let i = 0; i < 300; i++) {
      const [row] = await dbm.db.select().from(schema.turn).where(orm.eq(schema.turn.id, turnId));
      if (row && !["queued", "running"].includes(row.status)) return row;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("turn did not end in time");
  }

  const titleOf = async (threadId: string) =>
    (
      await dbm.db
        .select({ title: schema.thread.title })
        .from(schema.thread)
        .where(orm.eq(schema.thread.id, threadId))
    )[0]?.title;

  async function waitFor(check: () => Promise<boolean>) {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("condition not met in time");
  }

  const eventsOf = (threadId: string, type?: string) =>
    dbm.db
      .select()
      .from(schema.event)
      .where(
        orm.and(
          orm.eq(schema.event.streamId, threadId),
          orm.eq(schema.event.streamType, "thread"),
          ...(type ? [orm.eq(schema.event.type, type)] : []),
        ),
      )
      .orderBy(orm.asc(schema.event.seq));

  const replyOf = async (threadId: string) =>
    (await eventsOf(threadId, "message.posted")).filter(
      (e) => (e.payload as { role?: string }).role === "assistant",
    );

  const ledgerOf = (threadId: string) =>
    dbm.db.select().from(schema.usageLedger).where(orm.eq(schema.usageLedger.threadId, threadId));

  const callsFor = (needle: string) =>
    mock.calls.filter((c) => JSON.stringify(c.body.contents).includes(needle));

  beforeAll(async () => {
    // Asana's REST API is stood in for, and must be set before anything reads the environment.
    const { startMockAsana } = await import("../dev/mockAsana.ts");
    asana = await startMockAsana({ clientId: "c", clientSecret: "s" });
    process.env.ORBS_ASANA_API_URL = `${asana.url}/api/1.0`;
    dbm = await import("../db.ts");
    connectors = await import("../connectors/service.ts");
    orm = await import("drizzle-orm");
    ({ schema } = await import("@orbs/db"));
    turns = await import("./turns.ts");
    workerMod = await import("./worker.ts");
    bus = await import("./streamBus.ts");
    modelsMod = await import("../models.ts");
    vaultMod = await import("../connectors/vault.ts");
    const { startMockGemini } = await import("../dev/mockGemini.ts");
    mock = await startMockGemini(key);
    const { db } = dbm;
    await db.insert(schema.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
    for (const id of [alice, bob])
      await db.insert(schema.user).values({ id, name: id, email: `${id}@test.invalid` });
    await db.insert(schema.modelProvider).values({
      provider,
      name: "Test",
      apiKeyEnc: vaultMod.vault().encrypt(key, vaultMod.aad.providerKey(provider)),
      keyHint: "test",
      status: "connected",
      billingConfirmed: true,
    });
    await db.insert(schema.aiModel).values([
      { provider, modelId: model, displayName: "Test", inputUsdPerMtok: "1", outputUsdPerMtok: "4" },
      { provider, modelId: ghost, displayName: "Ghost", inputUsdPerMtok: "2", outputUsdPerMtok: "8" },
      { provider, modelId: unpriced, displayName: "Free" },
    ]);
    await bus.streamBus.start();
    unsubscribe = bus.streamBus.subscribe((_thread, item) => {
      if (item.type !== "delta") return;
      seen.set(item.turnId, [...(seen.get(item.turnId) ?? []), item.text]);
    });
    worker = workerMod.startWorker({
      providers: [provider],
      geminiBase: mock.url,
      pollMs: 50,
      heartbeatMs: 500,
      flushMs: 10,
      cancelPollMs: 50,
      retryDelaysMs: [10, 10],
      idleTimeoutMs: 400,
      overallTimeoutMs: 5_000,
    });
  });

  afterAll(async () => {
    if (!dbm) return;
    unsubscribe?.();
    await worker?.stop();
    await mock?.close();
    await asana?.close();
    const { db } = dbm;
    for (const id of threads) {
      await db.delete(schema.event).where(orm.eq(schema.event.streamId, id));
      await db.delete(schema.thread).where(orm.eq(schema.thread.id, id));
    }
    await db.delete(schema.connection).where(orm.eq(schema.connection.orgId, org));
    await db.delete(schema.usageLedger).where(orm.eq(schema.usageLedger.orgId, org));
    await db.delete(schema.customization).where(orm.eq(schema.customization.orgId, org));
    await db.delete(schema.aiModel).where(orm.eq(schema.aiModel.provider, provider));
    await db.delete(schema.modelProvider).where(orm.eq(schema.modelProvider.provider, provider));
    for (const id of [alice, bob]) await db.delete(schema.user).where(orm.eq(schema.user.id, id));
    await db.delete(schema.organization).where(orm.eq(schema.organization.id, org));
  });

  it("answers, streams the text live, stores only the final answer and bills the tokens", async () => {
    const t = await newThread();
    const { turnId, turn } = await ask(t, "hello brave world");
    expect(turn).toMatchObject({ status: "completed", errorCode: null, provider, modelId: model });

    const replies = await replyOf(t);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.payload).toMatchObject({
      role: "assistant",
      text: "Echo: hello brave world",
      turnId,
      provider,
      modelId: model,
    });
    expect((replies[0]?.payload as { partial?: boolean } | undefined)?.partial).toBeUndefined();
    expect(replies[0]?.actorId).toBeNull();
    // Pieces of text were never stored as events, but they did travel live and add up to the answer.
    expect((await eventsOf(t)).map((e) => e.type)).toEqual([
      "message.posted",
      "turn.started",
      "message.posted",
    ]);
    expect((seen.get(turnId) ?? []).join("")).toBe("Echo: hello brave world");

    expect(turn.inputTokens).toBeGreaterThan(0);
    expect(turn.outputTokens).toBe(4); // one cumulative figure from the stand-in, not a sum of chunks
    const ledger = await ledgerOf(t);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.userId).toBe(alice);
    expect(ledger[0]?.costMicroUsd).toBe(turn.inputTokens * 1 + turn.outputTokens * 4);
  });

  it("gives the model the saved instructions that apply, and the conversation so far", async () => {
    await dbm.db.insert(schema.customization).values([
      { orgId: org, ownerId: alice, kind: "instruction", scope: "org", name: "Policy", body: "ORG-RULE-XYZ" },
      {
        orgId: org,
        ownerId: alice,
        kind: "instruction",
        scope: "user",
        name: "Mine",
        body: "ALICE-RULE-XYZ",
      },
      { orgId: org, ownerId: bob, kind: "instruction", scope: "user", name: "His", body: "BOB-RULE-XYZ" },
      {
        orgId: org,
        ownerId: alice,
        kind: "instruction",
        scope: "user",
        name: "Off",
        body: "DISABLED-RULE-XYZ",
        enabled: false,
      },
    ]);
    const t = await newThread();
    await ask(t, "first question");
    await ask(t, "second question");
    const call = callsFor("second question").at(-1);
    const system = JSON.stringify(call?.body.systemInstruction);
    expect(system).toContain("ORG-RULE-XYZ");
    expect(system).toContain("ALICE-RULE-XYZ");
    expect(system).not.toContain("BOB-RULE-XYZ");
    expect(system).not.toContain("DISABLED-RULE-XYZ");
    const roles = ((call?.body.contents ?? []) as { role: string }[]).map((c) => c.role);
    expect(roles).toEqual(["user", "model", "user"]);
  });

  it("retries a passing failure before any text, and says so only if it keeps failing", async () => {
    const t = await newThread();
    const { turn } = await ask(t, "please #flaky retry");
    expect(turn.status).toBe("completed");
    expect(callsFor("#flaky")).toHaveLength(2);

    const t2 = await newThread();
    const before = callsFor("#503").length;
    const failed = (await ask(t2, "still down #503")).turn;
    expect(failed).toMatchObject({ status: "failed", errorCode: "overloaded" });
    expect(callsFor("#503").length - before).toBe(3); // the first try and two retries
    expect(await replyOf(t2)).toHaveLength(0);
    const events = await eventsOf(t2, "turn.failed");
    expect(events[0]?.payload).toMatchObject({ code: "overloaded" });
  });

  it.each([
    ["#429 please", "rate_limited"],
    ["#blocked please", "blocked"],
    ["#empty please", "empty"],
  ])("ends a reply with the right reason: %s", async (text, code) => {
    const t = await newThread();
    const { turn } = await ask(t, text);
    expect(turn).toMatchObject({ status: "failed", errorCode: code });
    expect(await replyOf(t)).toHaveLength(0);
  });

  it("bills the tokens of a reply that was blocked", async () => {
    const t = await newThread();
    await ask(t, "this is #blocked");
    const ledger = await ledgerOf(t);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.inputTokens).toBeGreaterThan(0);
  });

  it("reports a model the provider doesn't know", async () => {
    const t = await newThread();
    const { turn } = await ask(t, "hi", { kind: "model", provider, modelId: ghost });
    expect(turn).toMatchObject({ status: "failed", errorCode: "model_refused" });
  });

  it("stops on request and keeps what was written, marked as unfinished", async () => {
    const t = await newThread();
    const turnId = await dbm.db.transaction(async (tx) => {
      await tx.insert(schema.event).values({
        orgId: org,
        streamType: "thread",
        streamId: t,
        type: "message.posted",
        payload: { role: "user", text: "write slowly #slow" },
        actorId: alice,
      });
      return turns.enqueueTurn(tx, { orgId: org, threadId: t, userId: alice, engine: auto });
    });
    turns.wake();
    for (let i = 0; i < 200 && !(seen.get(turnId)?.length ?? 0); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(seen.get(turnId)?.join("")).toBe("Echo: ");
    expect(await turns.activeTurn(org, t, alice)).toMatchObject({ turnId, status: "running" });
    expect(await turns.cancelTurn(org, t, bob)).toBe(false); // somebody else's conversation
    expect(await turns.cancelTurn(org, t, alice)).toBe(true);
    const turn = await settle(turnId);
    expect(turn.status).toBe("cancelled");
    const [reply] = await replyOf(t);
    expect(reply?.payload).toMatchObject({ text: "Echo: ", partial: true });
    expect((await eventsOf(t, "turn.cancelled")).length).toBe(1);
    expect((await ledgerOf(t)).length).toBe(1); // tokens already spent are billed
    expect(await turns.activeTurn(org, t, alice)).toBeNull();
  });

  it("gives up when the model goes quiet, and keeps what arrived", async () => {
    const t = await newThread();
    const { turn } = await ask(t, "go quiet #slow");
    expect(turn).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect((await replyOf(t))[0]?.payload).toMatchObject({ partial: true });
  });

  it("takes one reply at a time per conversation", async () => {
    const t = await newThread();
    // A reply that is already being written (no worker will touch this fake one: it keeps beating).
    await dbm.db.insert(schema.turn).values({
      orgId: org,
      threadId: t,
      userId: alice,
      engine: auto,
      status: "running",
      heartbeatAt: new Date(Date.now() + 3_600_000),
    });
    await expect(
      dbm.db.transaction((tx) =>
        turns.enqueueTurn(tx, { orgId: org, threadId: t, userId: alice, engine: auto }),
      ),
    ).rejects.toMatchObject({ code: "busy" });
    await dbm.db.delete(schema.turn).where(orm.eq(schema.turn.threadId, t));
  });

  it("declares a reply whose worker disappeared as interrupted, so the conversation can go on", async () => {
    const t = await newThread();
    const [row] = await dbm.db
      .insert(schema.turn)
      .values({
        orgId: org,
        threadId: t,
        userId: alice,
        engine: auto,
        status: "running",
        heartbeatAt: new Date(Date.now() - 120_000),
      })
      .returning();
    expect(await workerMod.sweepStale(30_000)).toBeGreaterThanOrEqual(1);
    const turn = await settle((row as { id: string }).id);
    expect(turn).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect((await eventsOf(t, "turn.failed"))[0]?.payload).toMatchObject({ code: "interrupted" });
    const { turn: next } = await ask(t, "are you back?");
    expect(next.status).toBe("completed");
  });

  it("limits how fast one person can send messages", () => {
    const who = `fast-${tag}`;
    for (let i = 0; i < turns.MESSAGES_PER_MINUTE; i++) turns.takeMessageSlot(who);
    expect(() => turns.takeMessageSlot(who)).toThrowError(turns.TurnRefused);
    expect(() => turns.takeMessageSlot(`slow-${tag}`)).not.toThrow();
  });

  describe("naming a conversation after its topic", () => {
    const renames = (org_: string, threadId: string) =>
      dbm.db
        .select()
        .from(schema.event)
        .where(
          orm.and(
            orm.eq(schema.event.orgId, org_),
            orm.eq(schema.event.type, "thread.renamed"),
            orm.sql`${schema.event.payload}->>'threadId' = ${threadId}`,
          ),
        );

    it("replaces the placeholder after the first reply, tells every tab, and bills the naming call", async () => {
      const t = await newThread(alice, "New conversation");
      await ask(t, "manfaat olahraga pagi");
      await waitFor(async () => (await titleOf(t)) !== "New conversation");
      const title = (await titleOf(t)) ?? "";
      expect(title.startsWith("Echo:")).toBe(true);
      const [event] = await renames(org, t);
      expect(event?.actorId).toBeNull();
      expect(event?.payload).toMatchObject({ threadId: t, title, ownerId: alice, auto: true });
      expect((await ledgerOf(t)).length).toBe(2); // the reply and the title
    });

    it("never overrides a title the person wrote, even when it looks like the placeholder", async () => {
      const t = await newThread(alice, "New conversation");
      await dbm.db.insert(schema.event).values({
        orgId: org,
        streamType: "org",
        streamId: org,
        type: "thread.renamed",
        payload: { threadId: t, title: "New conversation", ownerId: alice },
        actorId: alice,
      });
      await ask(t, "halo");
      await new Promise((r) => setTimeout(r, 300));
      expect(await titleOf(t)).toBe("New conversation");
      expect((await ledgerOf(t)).length).toBe(1);
    });

    it("leaves a title that came from a template alone", async () => {
      const t = await newThread(alice, "Tambah server MCP");
      await ask(t, "halo");
      await new Promise((r) => setTimeout(r, 300));
      expect(await titleOf(t)).toBe("Tambah server MCP");
      expect((await ledgerOf(t)).length).toBe(1);
    });

    it("looks at the topic again every fourth reply, not on every message", async () => {
      const t = await newThread(alice, "New conversation");
      for (let i = 1; i <= 4; i++) {
        await ask(t, `pertanyaan nomor ${i}`);
        const expected = i === 1 ? 2 : i < 4 ? i + 1 : 6; // replies, plus a naming call after the 1st and the 4th
        await waitFor(async () => (await ledgerOf(t)).length === expected);
      }
      expect((await ledgerOf(t)).length).toBe(6);
    });

    it("doesn't replace a title the person changed while the model was thinking", async () => {
      const t = await newThread(alice, "New conversation");
      const asked = ask(t, "tolong ringkas");
      await asked;
      await waitFor(async () => (await titleOf(t)) !== "New conversation");
      // The compare-and-set only writes when the title is still what it read; a later person's rename sticks.
      await dbm.db.update(schema.thread).set({ title: "Judul saya" }).where(orm.eq(schema.thread.id, t));
      await dbm.db.insert(schema.event).values({
        orgId: org,
        streamType: "org",
        streamId: org,
        type: "thread.renamed",
        payload: { threadId: t, title: "Judul saya", ownerId: alice },
        actorId: alice,
      });
      for (let i = 0; i < 3; i++) await ask(t, `lanjut ${i}`);
      await ask(t, "lanjut lagi");
      await new Promise((r) => setTimeout(r, 300));
      expect(await titleOf(t)).toBe("Judul saya");
    });
  });

  describe("using the person's connected apps", () => {
    const token = `pat-${tag}-agent`;
    const toolNames = (call: { body: Record<string, unknown> } | undefined) =>
      ((call?.body.tools ?? []) as Array<{ functionDeclarations: Array<{ name: string }> }>).flatMap((t) =>
        t.functionDeclarations.map((d) => d.name),
      );
    const systemOf = (call: { body: Record<string, unknown> } | undefined) =>
      JSON.stringify(call?.body.systemInstruction);

    it("offers no tools to someone with no connected app, and says so", async () => {
      const t = await newThread(bob);
      await ask(t, "any tools? first-check", auto, bob);
      const call = callsFor("first-check").at(-1);
      expect(toolNames(call)).toEqual([]);
      expect(systemOf(call)).toContain("has not connected any app");
    });

    it("lets the model look things up, and answers from what the app returned", async () => {
      asana.allowToken(token);
      await connectors.connectWithToken(org, alice, "asana", token);
      const t = await newThread();
      const restBefore = asana.stats.restCalls.length;
      const { turnId, turn } = await ask(t, "list my work #tasks");
      expect(turn.status).toBe("completed");

      const first = callsFor("#tasks")[0];
      expect(toolNames(first)).toContain("asana__get_my_tasks");
      expect(systemOf(first)).toContain("provided tools");
      // Only the app's read-only actions are ever offered.
      expect(toolNames(first).every((n) => !/create|update|delete|add_/.test(n))).toBe(true);

      const [reply] = await replyOf(t);
      expect(((reply?.payload ?? {}) as { text?: string }).text).toContain("Write report");
      // Both of the account's workspaces are covered, and the model was told which exist.
      expect(((reply?.payload ?? {}) as { text?: string }).text).toContain("Review budget");
      expect(systemOf(first)).toContain("Mock Workspace, Second Org");
      expect(reply?.payload).toMatchObject({
        turnId,
        tools: [{ app: "Asana", tool: "get_my_tasks", ok: true }],
      });
      expect(asana.stats.restCalls.length).toBeGreaterThan(restBefore);
      expect(asana.stats.restCalls.slice(restBefore).every((c) => c.startsWith("GET "))).toBe(true);

      // The second round carried the tool turns back, including the thought signature, and billing covers both rounds.
      const second = callsFor("#tasks")[1];
      const contents = JSON.stringify(second?.body.contents);
      expect(contents).toContain("functionResponse");
      expect(contents).toContain("sig-mock");
      const ledger = await ledgerOf(t);
      expect(ledger).toHaveLength(1);
      expect(turn.outputTokens).toBeGreaterThan(5);
      expect(ledger[0]?.outputTokens).toBe(turn.outputTokens);
    });

    it("stops after the step limit and makes the model answer with what it has", async () => {
      const t = await newThread();
      const before = mock.calls.length;
      const { turn } = await ask(t, "never stop #loop");
      expect(turn.status).toBe("completed");
      const rounds = mock.calls
        .slice(before)
        .filter((c) => JSON.stringify(c.body.contents).includes("#loop"));
      expect(rounds).toHaveLength(7); // six rounds with tools, then one without
      expect(toolNames(rounds.at(-1))).toEqual([]);
      const [reply] = await replyOf(t);
      expect(((reply?.payload ?? {}) as { tools?: unknown[] }).tools).toHaveLength(6);
    });

    it("tells the model plainly when the app stopped accepting the token, then asks for a reconnect", async () => {
      asana.expireAccessTokens();
      const t = await newThread();
      const { turn } = await ask(t, "again please #tasks");
      expect(turn.status).toBe("completed");
      const [reply] = await replyOf(t);
      expect(((reply?.payload ?? {}) as { text?: string }).text).toContain("reconnect");
      expect(reply?.payload).toMatchObject({ tools: [{ app: "Asana", ok: false }] });
      // The connection is now marked, so the next reply offers no tools and says what to do.
      await ask(t, "and now? second-check");
      const call = callsFor("second-check").at(-1);
      expect(toolNames(call)).toEqual([]);
      expect(systemOf(call)).toContain("Needs to be reconnected");
    });
  });

  describe("which models may answer", () => {
    const stateOf = async (id: string) =>
      (await modelsMod.modelsForOrg(org)).find((m) => m.provider === provider && m.modelId === id);
    const setBilling = (confirmed: boolean) =>
      dbm.db
        .update(schema.modelProvider)
        .set({ billingConfirmed: confirmed })
        .where(orm.eq(schema.modelProvider.provider, provider));

    it("needs a price, and a provider confirmed as paid", async () => {
      expect(await stateOf(model)).toMatchObject({ available: true, off: null });
      expect(await stateOf(unpriced)).toMatchObject({ available: false, off: "unpriced" });
      await setBilling(false);
      try {
        expect(await stateOf(model)).toMatchObject({ available: false, off: "billing" });
        const t = await newThread();
        expect((await ask(t, "hi")).turn).toMatchObject({ status: "failed", errorCode: "no_model" });
        expect(
          (await ask(await newThread(), "hi", { kind: "model", provider, modelId: model })).turn,
        ).toMatchObject({
          status: "failed",
          errorCode: "model_unavailable",
        });
      } finally {
        await setBilling(true);
      }
      expect(await stateOf(model)).toMatchObject({ available: true });
    });

    it("never lets Automatic pick a model without a price", async () => {
      const { turn } = await ask(await newThread(), "which model?");
      expect(turn.modelId).not.toBe(unpriced);
    });
  });
});
