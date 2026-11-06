/**
 * Names a conversation after what it is about. A new conversation starts as "New conversation"; after the first
 * reply (and again every few replies, since topics drift) the model is asked for a short title. A title the person
 * typed themselves is never touched. Pure helpers here; the worker does the asking and saving.
 */
import type { ChatMessage } from "./gemini.ts";

/** Titles the app gives a conversation before it has a topic (see `threads.create` callers in the web app). */
const DEFAULT_TITLES = new Set(["new conversation", "percakapan baru", "conversation", "percakapan"]);

export const isDefaultTitle = (title: string) =>
  !title.trim() || DEFAULT_TITLES.has(title.trim().toLowerCase());

/** Longest title kept, in characters. */
export const MAX_TITLE_CHARS = 60;

/** The title is refreshed after every this-many replies, so it follows the topic without changing on each message. */
export const RETITLE_EVERY = 4;

/**
 * Whether a finished reply should (re)name the conversation. `replies` counts finished replies including this one.
 * `auto` is true when the current title was written by this feature rather than chosen by a person or a template.
 */
export function shouldRetitle(opts: {
  title: string;
  replies: number;
  auto: boolean;
  lockedByPerson: boolean;
}) {
  if (opts.lockedByPerson) return false;
  if (isDefaultTitle(opts.title)) return true;
  return opts.auto && opts.replies > 1 && opts.replies % RETITLE_EVERY === 0;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The request that asks for a title: the recent conversation, shortened, and the current title to keep if it fits. */
export function buildTitleRequest(
  messages: ChatMessage[],
  currentTitle: string,
): { system: string; messages: ChatMessage[] } {
  const recent = messages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Person" : "Assistant"}: ${clip(m.text.trim(), 600)}`)
    .join("\n\n");
  const keep = isDefaultTitle(currentTitle)
    ? ""
    : `\nThe current title is "${currentTitle}". Keep it exactly if it still describes the conversation.`;
  return {
    system:
      "You write titles for conversations. Reply with the title only: at most six words, in the language the person writes in, " +
      `no quotes, no markdown, no final period.${keep}`,
    messages: [{ role: "user", text: `Conversation:\n\n${recent}\n\nTitle:` }],
  };
}

/** Tidies what the model returned into a usable title, or null when there is nothing usable. */
export function cleanTitle(raw: string): string | null {
  const firstLine = raw.trim().split(/\r?\n/)[0] ?? "";
  const title = firstLine
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*(title|judul)\s*:\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/, "")
    .trim();
  if (!title) return null;
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : title;
}
