/**
 * Asking for a reply, and looking at or stopping one that is under way. The worker (worker.ts) does the writing.
 */
import { schema } from "@orbs/db";
import type { Engine, TurnState } from "@orbs/protocol";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createRateLimiter } from "../connectors/rateLimit.ts";
import { db } from "../db.ts";

type Tx = Pick<typeof db, "select" | "insert">;

/** Why a message can't be answered right now. */
export class TurnRefused extends Error {
  constructor(
    readonly code: "busy" | "rate_limited",
    readonly retryAfterMs = 0,
  ) {
    super(code);
  }
}

/** Messages one person may send per minute across all conversations. */
export const MESSAGES_PER_MINUTE = 20;
const limiter = createRateLimiter(MESSAGES_PER_MINUTE, 60_000);

/** Counts a message against the person's rate limit; throws `TurnRefused` when they are sending too fast. */
export function takeMessageSlot(userId: string) {
  const r = limiter.take(userId);
  if (!r.ok) throw new TurnRefused("rate_limited", r.retryAfterMs);
}

/** Wakes the worker right after a turn is queued instead of waiting for its next poll. Set by the worker. */
let wakeWorker: () => void = () => {};
export const onTurnQueued = (fn: () => void) => {
  wakeWorker = fn;
};
export const wake = () => wakeWorker();

/**
 * Queues the reply owed for a message. Call it inside the transaction that stores the message, after the thread row
 * was updated: that row lock makes two quick messages in one conversation take turns, so the second sees the first's turn.
 */
export async function enqueueTurn(
  tx: Tx,
  input: { orgId: string; threadId: string; userId: string; engine: Engine },
): Promise<string> {
  const [busy] = await tx
    .select({ id: schema.turn.id })
    .from(schema.turn)
    .where(and(eq(schema.turn.threadId, input.threadId), inArray(schema.turn.status, ["queued", "running"])))
    .limit(1);
  if (busy) throw new TurnRefused("busy");
  const [row] = await tx
    .insert(schema.turn)
    .values({ orgId: input.orgId, threadId: input.threadId, userId: input.userId, engine: input.engine })
    .returning({ id: schema.turn.id });
  if (!row) throw new Error("turn insert returned no row");
  return row.id;
}

export async function ownsThread(orgId: string, threadId: string, userId: string) {
  const [row] = await db
    .select({ id: schema.thread.id })
    .from(schema.thread)
    .where(
      and(
        eq(schema.thread.id, threadId),
        eq(schema.thread.orgId, orgId),
        eq(schema.thread.createdBy, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export function toTurnState(row: typeof schema.turn.$inferSelect): TurnState {
  return {
    turnId: row.id,
    status: row.status,
    provider: row.provider,
    modelId: row.modelId,
    errorCode: (row.errorCode as TurnState["errorCode"]) ?? null,
  };
}

/** The reply being written for this conversation, if any. Only its owner may look. */
export async function activeTurn(orgId: string, threadId: string, userId: string): Promise<TurnState | null> {
  if (!(await ownsThread(orgId, threadId, userId))) return null;
  const [row] = await db
    .select()
    .from(schema.turn)
    .where(and(eq(schema.turn.threadId, threadId), inArray(schema.turn.status, ["queued", "running"])))
    .orderBy(desc(schema.turn.createdAt))
    .limit(1);
  return row ? toTurnState(row) : null;
}

/** Asks the worker to stop the reply being written; whatever was written so far is kept. */
export async function cancelTurn(orgId: string, threadId: string, userId: string): Promise<boolean> {
  if (!(await ownsThread(orgId, threadId, userId))) return false;
  await db
    .update(schema.turn)
    .set({ cancelRequested: true })
    .where(and(eq(schema.turn.threadId, threadId), inArray(schema.turn.status, ["queued", "running"])));
  return true;
}
