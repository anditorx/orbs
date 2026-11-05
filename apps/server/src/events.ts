import { schema } from "@orbs/db";
import type { OrbsEvent } from "@orbs/protocol";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, sql } from "./db.ts";

type EventRow = typeof schema.event.$inferSelect;
type Listener = (event: OrbsEvent & { orgId: string }) => void;

export function toOrbsEvent(row: EventRow): OrbsEvent {
  return {
    seq: row.seq,
    id: row.id,
    streamType: row.streamType,
    streamId: row.streamId,
    type: row.type,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    actorId: row.actorId,
    occurredAt: row.occurredAt.toISOString(),
  };
}

/** Appends one event. Callers may pass a transaction to write projections atomically. */
export async function appendEvent(
  input: {
    orgId: string;
    streamType: string;
    streamId: string;
    type: string;
    payload?: Record<string, unknown>;
    actorId?: string | null;
  },
  tx: Pick<typeof db, "insert"> = db,
): Promise<OrbsEvent> {
  const [row] = await tx
    .insert(schema.event)
    .values({
      orgId: input.orgId,
      streamType: input.streamType,
      streamId: input.streamId,
      type: input.type,
      payload: input.payload ?? {},
      actorId: input.actorId ?? null,
    })
    .returning();
  if (!row) throw new Error("event insert returned no row");
  return toOrbsEvent(row);
}

export async function listEvents(orgId: string, streamType: string, streamId: string, afterSeq: number) {
  const rows = await db
    .select()
    .from(schema.event)
    .where(
      and(
        eq(schema.event.orgId, orgId),
        eq(schema.event.streamType, streamType),
        eq(schema.event.streamId, streamId),
        gt(schema.event.seq, afterSeq),
      ),
    )
    .orderBy(asc(schema.event.seq))
    .limit(1000);
  return rows.map(toOrbsEvent);
}

/**
 * Fans out Postgres NOTIFY messages (see migration 0001_event_notify) to in-process
 * subscribers. Every API instance runs one listener, so this scales horizontally.
 */
class EventBus {
  #listeners = new Set<Listener>();
  #started: Promise<void> | undefined;

  start() {
    this.#started ??= sql.listen("orbs_event", (raw) => void this.#dispatch(raw)).then(() => undefined);
    return this.#started;
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #dispatch(raw: string) {
    if (this.#listeners.size === 0) return;
    let seq: number;
    try {
      seq = Number(JSON.parse(raw).seq);
    } catch {
      return;
    }
    const [row] = await db.select().from(schema.event).where(eq(schema.event.seq, seq)).limit(1);
    if (!row) return;
    const event = { ...toOrbsEvent(row), orgId: row.orgId };
    for (const listener of this.#listeners) listener(event);
  }
}

export const eventBus = new EventBus();
