/**
 * Writes the replies. Takes queued turns from the database (the queue), asks the model, streams the text out live,
 * and stores the final answer as an event. Everything it does is recorded on the `turn` row, so a restart can't leave
 * a conversation waiting forever: a turn whose worker stopped beating is declared interrupted.
 *
 * It runs inside the API process for now; nothing here depends on that, so it can move to its own process later.
 */
import { schema } from "@orbs/db";
import type { Engine, TurnErrorCode, TurnState } from "@orbs/protocol";
import { and, asc, count, desc, eq, lt, sql } from "drizzle-orm";
import { PROVIDERS } from "../connectors/providers.ts";
import { aad, vault } from "../connectors/vault.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { appendEvent } from "../events.ts";
import { modelsForOrg } from "../models.ts";
import { recordUsage } from "../usage.ts";
import { pickAutoModel } from "./autoModel.ts";
import {
  ChatError,
  NO_USAGE,
  type RawContent,
  type RawPart,
  streamGemini,
  type ToolCall,
  type Usage,
} from "./gemini.ts";
import { buildHistory, buildSystemPrompt, type ConnectedApp, type InstructionText } from "./prompt.ts";
import { MAX_DELTA_CHARS, streamBus } from "./streamBus.ts";
import { buildTitleRequest, cleanTitle, shouldRetitle } from "./title.ts";
import { EMPTY_TOOLSET, loadToolset, type Toolset } from "./tools.ts";
import { onTurnQueued, toTurnState } from "./turns.ts";

type TurnRow = typeof schema.turn.$inferSelect;

export interface WorkerOptions {
  /** Replies written at the same time across all conversations. */
  concurrency?: number;
  pollMs?: number;
  /** A running turn that hasn't beaten for this long is declared interrupted. */
  staleMs?: number;
  heartbeatMs?: number;
  /** Waits before each retry of a transient failure that happened before any text arrived. */
  retryDelaysMs?: number[];
  maxOutputTokens?: number;
  historyTokens?: number;
  /** Give up when the model sends nothing for this long. */
  idleTimeoutMs?: number;
  /** Give up on a reply that takes longer than this in total. */
  overallTimeoutMs?: number;
  /** How often text written so far is sent to the screen. */
  flushMs?: number;
  /** How often a running reply looks for a stop request. */
  cancelPollMs?: number;
  /** Most tool rounds in one reply; after that the model must answer with what it has. */
  maxToolSteps?: number;
  /** Name conversations after their topic once there is a reply. */
  autoTitle?: boolean;
  /** Providers that have an adapter. */
  providers?: string[];
  /** Test hooks. */
  geminiBase?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULTS = {
  concurrency: 4,
  pollMs: 1_000,
  staleMs: 30_000,
  heartbeatMs: 5_000,
  retryDelaysMs: [1_000, 3_000],
  maxOutputTokens: 4_096,
  historyTokens: 30_000,
  idleTimeoutMs: 30_000,
  overallTimeoutMs: 120_000,
  flushMs: 200,
  cancelPollMs: 500,
  autoTitle: true,
  maxToolSteps: 6,
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

/** Tool requests honoured in one round; the rest are answered with a refusal. */
const MAX_CALLS_PER_STEP = 6;

const sumUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

interface Prepared {
  provider: string;
  modelId: string;
  apiKey: string;
  system: string;
  history: ReturnType<typeof buildHistory>;
  tools: Toolset;
}

/** Works out which model answers, with what key, and what it is told. Throws `ChatError` when it can't. */
async function prepare(
  turn: TurnRow,
  o: Required<Pick<WorkerOptions, "historyTokens">> & Pick<WorkerOptions, "providers">,
): Promise<Prepared> {
  const engine = turn.engine as Engine;
  if (engine.kind === "agent")
    throw new ChatError("model_unavailable", false, "agents are not available yet");

  const models = await modelsForOrg(turn.orgId);
  // Only Gemini has an adapter so far.
  const adapters = o.providers ?? ["gemini"];
  const usable = models.filter((m) => adapters.includes(m.provider));
  let picked: { provider: string; modelId: string } | undefined;
  if (engine.kind === "model") {
    const m = usable.find((x) => x.provider === engine.provider && x.modelId === engine.modelId);
    if (!m) throw new ChatError("model_unavailable", false, "model not offered");
    if (!m.available) throw new ChatError("model_unavailable", false, `model off: ${m.off}`);
    picked = m;
  } else {
    picked = pickAutoModel(usable);
    if (!picked) throw new ChatError("no_model", false, "no model can be used");
  }

  const [provider] = await db
    .select({ apiKeyEnc: schema.modelProvider.apiKeyEnc, id: schema.modelProvider.id })
    .from(schema.modelProvider)
    .where(eq(schema.modelProvider.provider, picked.provider))
    .limit(1);
  if (!provider) throw new ChatError("model_unavailable", false, "provider not configured");
  let apiKey: string;
  try {
    apiKey = vault().decrypt(provider.apiKeyEnc, aad.providerKey(picked.provider));
  } catch {
    throw new ChatError("provider_rejected", false, "stored key can't be read");
  }

  const [thread] = await db
    .select({ projectId: schema.thread.projectId })
    .from(schema.thread)
    .where(eq(schema.thread.id, turn.threadId))
    .limit(1);
  const projectId = thread?.projectId ?? null;

  const saved = await db
    .select({
      scope: schema.customization.scope,
      ownerId: schema.customization.ownerId,
      projectId: schema.customization.projectId,
      name: schema.customization.name,
      body: schema.customization.body,
    })
    .from(schema.customization)
    .where(
      and(
        eq(schema.customization.orgId, turn.orgId),
        eq(schema.customization.kind, "instruction"),
        eq(schema.customization.enabled, true),
      ),
    )
    .orderBy(asc(schema.customization.createdAt));
  const instructions: InstructionText[] = saved
    .filter(
      (i) =>
        (i.projectId === null || i.projectId === projectId) &&
        (i.scope === "org" || i.ownerId === turn.userId),
    )
    .map((i) => ({ scope: i.projectId ? "project" : i.scope, name: i.name, body: i.body }));

  // The apps this person connected in this organization, so the assistant states facts instead of guessing.
  const connected = await db
    .select({
      provider: schema.connection.provider,
      status: schema.connection.status,
      workspaces: schema.connection.workspaceName,
    })
    .from(schema.connection)
    .where(and(eq(schema.connection.orgId, turn.orgId), eq(schema.connection.userId, turn.userId)));
  const connections: ConnectedApp[] = connected.map((c) => ({
    name: PROVIDERS[c.provider]?.name ?? c.provider,
    status: c.status,
    workspaces: c.workspaces,
  }));

  // The person's connected apps become tools, unless the model can't call tools. A broken app only loses its tools.
  let tools: Toolset = EMPTY_TOOLSET;
  if (!/^gemma/i.test(picked.modelId)) {
    try {
      tools = await loadToolset(turn.orgId, turn.userId);
    } catch (error) {
      console.error(
        "agent turn: loading tools failed",
        turn.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const events = await db
    .select({ type: schema.event.type, payload: schema.event.payload })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.orgId, turn.orgId),
        eq(schema.event.streamType, "thread"),
        eq(schema.event.streamId, turn.threadId),
        eq(schema.event.type, "message.posted"),
      ),
    )
    .orderBy(desc(schema.event.seq))
    .limit(200);
  const history = buildHistory(
    events.reverse().map((e) => ({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> })),
    o.historyTokens,
  );

  return {
    provider: picked.provider,
    modelId: picked.modelId,
    apiKey,
    system: buildSystemPrompt({
      now: new Date(),
      instructions,
      connections,
      toolsOn: tools.declarations.length > 0,
    }),
    history,
    tools,
  };
}

async function publishState(threadId: string, state: TurnState) {
  await streamBus.publish(threadId, { type: "status", state }).catch(() => {});
}

/** Declares turns whose worker stopped beating as interrupted, so the conversation can go on. */
export async function sweepStale(staleMs: number) {
  const cutoff = new Date(Date.now() - staleMs);
  const stuck = await db
    .update(schema.turn)
    .set({ status: "failed", errorCode: "interrupted", endedAt: new Date() })
    .where(and(eq(schema.turn.status, "running"), lt(schema.turn.heartbeatAt, cutoff)))
    .returning();
  for (const t of stuck) {
    await appendEvent({
      orgId: t.orgId,
      streamType: "thread",
      streamId: t.threadId,
      type: "turn.failed",
      payload: { turnId: t.id, code: "interrupted" },
    }).catch(() => {});
    await publishState(t.threadId, toTurnState(t));
  }
  return stuck.length;
}

async function runTool(turn: TurnRow, tools: Toolset, call: ToolCall) {
  const tell = (status: "running" | "done" | "failed", app: string, tool: string) =>
    streamBus.publish(turn.threadId, { type: "tool", turnId: turn.id, app, tool, status }).catch(() => {});
  const what = tools.describe(call.name);
  await tell("running", what.app, what.tool);
  const result = await tools.run(call);
  await tell(result.ok ? "done" : "failed", result.app, result.tool);
  return result;
}

export function startWorker(options: WorkerOptions = {}) {
  const o = { ...DEFAULTS, ...options };
  let inflight = 0;
  let ticking = false;
  let stopped = false;
  const live = new Set<Promise<void>>();

  async function claim(): Promise<TurnRow | null> {
    return db.transaction(async (tx) => {
      const [next] = await tx
        .select()
        .from(schema.turn)
        .where(eq(schema.turn.status, "queued"))
        .orderBy(asc(schema.turn.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!next) return null;
      const [row] = await tx
        .update(schema.turn)
        .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date() })
        .where(eq(schema.turn.id, next.id))
        .returning();
      return row ?? null;
    });
  }

  async function tick() {
    if (ticking || stopped) return;
    ticking = true;
    try {
      while (!stopped && inflight < o.concurrency) {
        const turn = await claim();
        if (!turn) break;
        inflight++;
        const job = run(turn)
          .catch((error) => console.error("agent turn crashed", turn.id, error))
          .finally(() => {
            inflight--;
            live.delete(job);
            void tick();
          });
        live.add(job);
      }
    } catch (error) {
      console.error("agent worker poll failed", error);
    } finally {
      ticking = false;
    }
  }

  async function run(turn: TurnRow) {
    const ctl = new AbortController();
    let stopReason: "cancel" | "timeout" | null = null;
    const stop = (why: "cancel" | "timeout") => {
      stopReason ??= why;
      ctl.abort();
    };
    const overall = setTimeout(() => stop("timeout"), o.overallTimeoutMs);
    let beat = 0;
    const watcher = setInterval(async () => {
      try {
        beat += o.cancelPollMs;
        const [row] = await db
          .select({ cancel: schema.turn.cancelRequested })
          .from(schema.turn)
          .where(eq(schema.turn.id, turn.id))
          .limit(1);
        if (row?.cancel) stop("cancel");
        if (beat >= o.heartbeatMs) {
          beat = 0;
          await db.update(schema.turn).set({ heartbeatAt: new Date() }).where(eq(schema.turn.id, turn.id));
        }
      } catch {
        // A hiccup here must not kill the reply; the next beat tries again.
      }
    }, o.cancelPollMs);

    let provider: string | null = null;
    let modelId: string | null = null;
    let prepared: Prepared | undefined;
    const used: Array<{ app: string; tool: string; ok: boolean }> = [];
    let text = "";
    let usage: Usage = NO_USAGE;
    let pending = "";
    let n = 0;
    let flushing: Promise<void> = Promise.resolve();
    const flush = () => {
      if (!pending) return;
      const chunk = pending;
      pending = "";
      flushing = flushing.then(async () => {
        for (let i = 0; i < chunk.length; i += MAX_DELTA_CHARS) {
          await streamBus
            .publish(turn.threadId, {
              type: "delta",
              turnId: turn.id,
              n: n++,
              text: chunk.slice(i, i + MAX_DELTA_CHARS),
            })
            .catch(() => {});
        }
      });
    };
    const flusher = setInterval(flush, o.flushMs);

    let outcome:
      | { status: "completed" }
      | { status: "failed"; code: TurnErrorCode }
      | { status: "cancelled" };
    try {
      if (turn.cancelRequested) throw new CancelledBeforeStart();
      prepared = await prepare(turn, o);
      provider = prepared.provider;
      modelId = prepared.modelId;
      await db.update(schema.turn).set({ provider, modelId }).where(eq(schema.turn.id, turn.id));
      await appendEvent({
        orgId: turn.orgId,
        streamType: "thread",
        streamId: turn.threadId,
        type: "turn.started",
        payload: { turnId: turn.id, provider, modelId },
      });
      await publishState(turn.threadId, {
        turnId: turn.id,
        status: "running",
        provider,
        modelId,
        errorCode: null,
      });

      // One reply can take several rounds: the model asks for a tool, Orbs runs it and answers, until the model
      // writes the answer itself. Past the step limit the tools are withheld so it has to.
      const extra: RawContent[] = [];
      let carried: Usage = NO_USAGE;
      for (let step = 0; ; step++) {
        const withTools = step < o.maxToolSteps && prepared.tools.declarations.length > 0;
        const calls: ToolCall[] = [];
        let parts: RawPart[] = [];
        let produced = false;
        let started = false;
        for (let attempt = 0; ; attempt++) {
          try {
            for await (const ev of streamGemini({
              apiKey: prepared.apiKey,
              model: prepared.modelId,
              system: prepared.system,
              messages: prepared.history,
              extra,
              ...(withTools && { tools: prepared.tools.declarations }),
              maxOutputTokens: o.maxOutputTokens,
              signal: ctl.signal,
              idleTimeoutMs: o.idleTimeoutMs,
              // Each round reports its own running total; the reply's usage is the rounds added up.
              onUsage: (u) => {
                usage = sumUsage(carried, u);
              },
              ...(o.fetchImpl && { fetchImpl: o.fetchImpl }),
              ...((o.geminiBase ?? env.ORBS_GEMINI_API_URL) && {
                base: o.geminiBase ?? env.ORBS_GEMINI_API_URL,
              }),
            })) {
              if (ev.type === "text") {
                // A new round's words start a new paragraph.
                if (!started && text !== "") {
                  text += "\n\n";
                  pending += "\n\n";
                }
                started = true;
                produced = true;
                text += ev.text;
                pending += ev.text;
              } else if (ev.type === "call") {
                produced = true;
                calls.push(ev.call);
              } else {
                parts = ev.parts;
              }
            }
            break;
          } catch (error) {
            const delay = o.retryDelaysMs[attempt];
            const retryable =
              error instanceof ChatError &&
              error.transient &&
              !produced &&
              delay !== undefined &&
              !ctl.signal.aborted;
            if (!retryable) throw error;
            await sleep(delay, ctl.signal);
            if (ctl.signal.aborted) throw error;
          }
        }
        carried = usage;
        if (calls.length === 0) break;

        const answers: RawPart[] = [];
        for (const call of calls.slice(0, MAX_CALLS_PER_STEP)) {
          if (ctl.signal.aborted) break;
          const result = await runTool(turn, prepared.tools, call);
          used.push({ app: result.app, tool: result.tool, ok: result.ok });
          answers.push({ functionResponse: { name: call.name, response: result.response } });
        }
        if (ctl.signal.aborted) break;
        // Every request must be answered, or Gemini refuses the next round.
        for (const call of calls.slice(MAX_CALLS_PER_STEP)) {
          answers.push({
            functionResponse: { name: call.name, response: { error: "Too many tool requests at once." } },
          });
        }
        extra.push({ role: "model", parts }, { role: "user", parts: answers });
      }
      outcome = { status: "completed" };
    } catch (error) {
      if (error instanceof CancelledBeforeStart || (ctl.signal.aborted && stopReason === "cancel")) {
        outcome = { status: "cancelled" };
      } else if (ctl.signal.aborted && stopReason === "timeout") {
        outcome = { status: "failed", code: "timeout" };
      } else if (error instanceof ChatError) {
        outcome = { status: "failed", code: error.code };
      } else {
        console.error("agent turn failed", turn.id, error);
        outcome = { status: "failed", code: "internal" };
      }
    } finally {
      clearTimeout(overall);
      clearInterval(watcher);
      clearInterval(flusher);
    }

    flush();
    await flushing;

    // Whatever was written is kept, even when the reply didn't finish: the person saw it.
    try {
      const base = { orgId: turn.orgId, streamType: "thread", streamId: turn.threadId };
      if (text.trim()) {
        await appendEvent({
          ...base,
          type: "message.posted",
          payload: {
            role: "assistant",
            text,
            turnId: turn.id,
            provider,
            modelId,
            ...(outcome.status !== "completed" && { partial: true }),
            ...(used.length > 0 && { tools: used }),
          },
          actorId: null,
        });
        await db
          .update(schema.thread)
          .set({ updatedAt: new Date() })
          .where(eq(schema.thread.id, turn.threadId));
      }
      if (outcome.status === "failed") {
        await appendEvent({ ...base, type: "turn.failed", payload: { turnId: turn.id, code: outcome.code } });
      } else if (outcome.status === "cancelled") {
        await appendEvent({ ...base, type: "turn.cancelled", payload: { turnId: turn.id } });
      }
    } catch (error) {
      console.error("agent turn: storing the result failed", turn.id, error);
    }

    // Tokens spent are billed even when the reply failed or was stopped.
    if (provider && modelId && usage.inputTokens + usage.outputTokens > 0) {
      await recordUsage({
        orgId: turn.orgId,
        userId: turn.userId,
        projectId: await projectOf(turn.threadId),
        threadId: turn.threadId,
        provider,
        modelId,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
      }).catch((error) => console.error("agent turn: recording usage failed", turn.id, error));
    }

    const errorCode = outcome.status === "failed" ? outcome.code : null;
    const [done] = await db
      .update(schema.turn)
      .set({
        status: outcome.status,
        errorCode,
        endedAt: new Date(),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
      .where(eq(schema.turn.id, turn.id))
      .returning();
    await publishState(
      turn.threadId,
      done ? toTurnState(done) : { turnId: turn.id, status: outcome.status, provider, modelId, errorCode },
    );
    if (o.autoTitle && outcome.status === "completed" && prepared) {
      await retitle(turn, prepared, text).catch((error) =>
        console.error("agent turn: naming failed", turn.id, error),
      );
    }
  }

  /**
   * Names the conversation after its topic once a reply has finished. Best effort: any failure just leaves the
   * title as it was. A title a person typed is never replaced, and the save only happens if the title is still what
   * we read, so a rename made while the model was thinking wins.
   */
  async function retitle(turn: TurnRow, ctx: Prepared, reply: string) {
    const [thread] = await db
      .select({ title: schema.thread.title })
      .from(schema.thread)
      .where(eq(schema.thread.id, turn.threadId))
      .limit(1);
    if (!thread) return;
    const [done] = await db
      .select({ n: count() })
      .from(schema.turn)
      .where(and(eq(schema.turn.threadId, turn.threadId), eq(schema.turn.status, "completed")));
    const renames = await db
      .select({ actorId: schema.event.actorId })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.orgId, turn.orgId),
          eq(schema.event.streamType, "org"),
          eq(schema.event.type, "thread.renamed"),
          sql`${schema.event.payload}->>'threadId' = ${turn.threadId}`,
        ),
      );
    const lockedByPerson = renames.some((r) => r.actorId !== null);
    if (
      !shouldRetitle({
        title: thread.title,
        replies: done?.n ?? 1,
        auto: renames.length > 0 && !lockedByPerson,
        lockedByPerson,
      })
    )
      return;

    const request = buildTitleRequest([...ctx.history, { role: "assistant", text: reply }], thread.title);
    let raw = "";
    let used: Usage = NO_USAGE;
    try {
      for await (const ev of streamGemini({
        apiKey: ctx.apiKey,
        model: ctx.modelId,
        system: request.system,
        messages: request.messages,
        maxOutputTokens: 256,
        idleTimeoutMs: 15_000,
        onUsage: (u) => {
          used = u;
        },
        ...(o.fetchImpl && { fetchImpl: o.fetchImpl }),
        ...((o.geminiBase ?? env.ORBS_GEMINI_API_URL) && { base: o.geminiBase ?? env.ORBS_GEMINI_API_URL }),
      })) {
        if (ev.type === "text") raw += ev.text;
      }
    } catch {
      // The title is a nicety; the reply is already delivered.
    }
    // Asking for a title costs tokens like anything else.
    if (used.inputTokens + used.outputTokens > 0) {
      await recordUsage({
        orgId: turn.orgId,
        userId: turn.userId,
        projectId: await projectOf(turn.threadId),
        threadId: turn.threadId,
        provider: ctx.provider,
        modelId: ctx.modelId,
        inputTokens: used.inputTokens,
        cachedInputTokens: used.cachedInputTokens,
        outputTokens: used.outputTokens,
        reasoningTokens: used.reasoningTokens,
      }).catch(() => {});
    }
    const title = cleanTitle(raw);
    if (!title || title === thread.title) return;
    const saved = await db
      .update(schema.thread)
      .set({ title })
      .where(and(eq(schema.thread.id, turn.threadId), eq(schema.thread.title, thread.title)))
      .returning({ id: schema.thread.id });
    if (saved.length === 0) return;
    // Same event a person's rename sends (without an author), so every open tab refreshes its list.
    await appendEvent({
      orgId: turn.orgId,
      streamType: "org",
      streamId: turn.orgId,
      type: "thread.renamed",
      payload: { threadId: turn.threadId, title, ownerId: turn.userId, auto: true },
      actorId: null,
    });
  }

  const poll = setInterval(() => void tick(), o.pollMs);
  const sweep = setInterval(() => void sweepStale(o.staleMs).catch(() => {}), Math.max(1_000, o.staleMs / 3));
  onTurnQueued(() => void tick());
  void sweepStale(o.staleMs).catch(() => {});
  void tick();

  return {
    wake: () => void tick(),
    /** Stops taking work and waits for replies in progress to finish (or be stopped). */
    async stop() {
      stopped = true;
      clearInterval(poll);
      clearInterval(sweep);
      onTurnQueued(() => {});
      await Promise.allSettled([...live]);
    },
  };
}

class CancelledBeforeStart extends Error {}

async function projectOf(threadId: string) {
  const [row] = await db
    .select({ projectId: schema.thread.projectId })
    .from(schema.thread)
    .where(eq(schema.thread.id, threadId))
    .limit(1);
  return row?.projectId ?? null;
}
