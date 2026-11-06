/**
 * The live side of a reply: pieces of text as they are written and status changes. None of it is stored (only the
 * final answer is, as an event); it travels over Postgres NOTIFY so any API instance can show a reply that another
 * one is writing, like the event bus does for stored events.
 */
import type { TurnStreamItem } from "@orbs/protocol";
import { sql } from "../db.ts";

const CHANNEL = "orbs_stream";
/** NOTIFY payloads are limited to 8000 bytes, so long text is sent in pieces of at most this many characters. */
export const MAX_DELTA_CHARS = 1_000;

type Listener = (threadId: string, item: TurnStreamItem) => void;

class StreamBus {
  #listeners = new Set<Listener>();
  #started: Promise<void> | undefined;

  start() {
    this.#started ??= sql.listen(CHANNEL, (raw) => this.#dispatch(raw)).then(() => undefined);
    return this.#started;
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async publish(threadId: string, item: TurnStreamItem) {
    await sql.notify(CHANNEL, JSON.stringify({ threadId, item }));
  }

  #dispatch(raw: string) {
    if (this.#listeners.size === 0) return;
    let parsed: { threadId?: unknown; item?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed.threadId !== "string" || typeof parsed.item !== "object" || parsed.item === null)
      return;
    for (const listener of this.#listeners) listener(parsed.threadId, parsed.item as TurnStreamItem);
  }
}

export const streamBus = new StreamBus();
