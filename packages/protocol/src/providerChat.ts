import { parseProviderPrompt } from "./curl.ts";

/** What the assistant needs to say next. The screen turns each one into a sentence in the person's language. */
export type ProviderChatAsk =
  | "provider"
  | "unknownProvider"
  | "key"
  | "noKey"
  | "placeholderKey"
  | "labels"
  | "ready";

export interface ProviderChatState {
  provider?: string;
  apiKey?: string;
  name?: string;
  projectName?: string;
  projectNumber?: string;
  labelsAsked: boolean;
  /** What the last question was, so a short reply is read as an answer to it. */
  awaiting: ProviderChatAsk | null;
}

export const emptyProviderChat = (provider?: string): ProviderChatState => ({
  provider,
  labelsAsked: false,
  awaiting: null,
});

const PLACEHOLDER_KEYS = new Set(["YOUR_API_KEY", "…", "..."]);
const SKIP = /^\s*(skip|lewati|no|nope|none|tidak|nggak|gak|-|—)\s*[.!]?\s*$/i;

/**
 * Reads one message from the person and decides the next question. Nothing is guessed: it looks for the details it
 * needs (which provider, the API key, optional labels) in whatever was written, however it was written, and asks
 * only for what is still missing.
 */
export function replyToProviderChat(
  state: ProviderChatState,
  reply: string,
  providers: Array<{ id: string; name: string }>,
): { state: ProviderChatState; ask: ProviderChatAsk } {
  const found = parseProviderPrompt(reply);
  const next: ProviderChatState = { ...state };
  const text = reply.trim();
  let attempted: "provider" | "key" | null = null;

  if (!next.provider) {
    const said = (found.provider ?? text).toLowerCase();
    const hit = providers.find((p) => said.includes(p.id) || said.includes(p.name.toLowerCase()));
    if (hit) next.provider = hit.id;
    // Flag a provider only when they named one; a plain "help me add a provider" names none.
    else if (found.provider || state.awaiting === "provider" || state.awaiting === "unknownProvider")
      attempted = "provider";
  }

  if (!next.apiKey) {
    let key = found.apiKey;
    if (
      !key &&
      state.awaiting &&
      ["key", "noKey", "placeholderKey"].includes(state.awaiting) &&
      /^\S{20,}$/.test(text)
    )
      key = text;
    if (key && PLACEHOLDER_KEYS.has(key)) {
      next.awaiting = "placeholderKey";
      return { state: next, ask: "placeholderKey" };
    }
    if (key) next.apiKey = key;
    else if (state.awaiting === "key" || state.awaiting === "noKey" || state.awaiting === "placeholderKey")
      attempted = "key";
  }

  if (found.name) next.name = found.name;
  if (found.projectName) next.projectName = found.projectName;
  if (found.projectNumber) next.projectNumber = found.projectNumber;
  const gaveLabels = Boolean(found.name || found.projectName || found.projectNumber);
  if (state.awaiting === "labels") {
    next.labelsAsked = true;
    if (!gaveLabels && !SKIP.test(text) && text.length > 0 && text.length <= 60 && !text.includes("\n"))
      next.name = text;
  }

  const done = (ask: ProviderChatAsk) => {
    next.awaiting = ask;
    return { state: next, ask };
  };
  if (!next.provider) return done(attempted === "provider" ? "unknownProvider" : "provider");
  if (!next.apiKey) return done(attempted === "key" ? "noKey" : "key");
  if (!next.labelsAsked && !gaveLabels && !next.name && !next.projectName && !next.projectNumber) {
    next.labelsAsked = true;
    return done("labels");
  }
  next.labelsAsked = true;
  return done("ready");
}

/** Hides the key in text shown back to the person, so it never sits in the transcript. */
export function redactKey(text: string, apiKey: string | undefined): string {
  if (!apiKey) return text;
  return text.split(apiKey).join(`••••${apiKey.slice(-4)}`);
}
