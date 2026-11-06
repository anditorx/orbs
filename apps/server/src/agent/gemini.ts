/**
 * Talks to Gemini to write a reply, streaming it as it arrives. Pure apart from the injected `fetch`, so it is
 * tested without the network. Three things here were learned from the real API, not assumed:
 *  - the stream separates events with CRLF-CRLF, not LF-LF, so a naive parser sees nothing;
 *  - every chunk carries the usage counted so far (cumulative), so the last one is the total and summing would
 *    multiply the cost;
 *  - thinking tokens are billed as output, so they are added to the output count.
 * The key travels in a header, never in a URL, and never appears in an error.
 */
import type { TurnErrorCode } from "@orbs/protocol";
import { GEMINI_BASE } from "../geminiApi.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const NO_USAGE: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

/** A reply that failed. `transient` ones (busy provider, rate limit, network) are worth another attempt. */
export class ChatError extends Error {
  constructor(
    readonly code: TurnErrorCode,
    readonly transient: boolean,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** One content part exactly as Gemini sent it. Kept whole because Gemini 3 wants its thought signatures sent back. */
export type RawPart = Record<string, unknown>;
export interface RawContent {
  role: "user" | "model";
  parts: RawPart[];
}

/** A tool the model may ask for. `parameters` is a JSON Schema of the arguments, or absent for none. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "call"; call: ToolCall }
  | { type: "done"; finishReason: string; usage: Usage; parts: RawPart[] };

const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

/**
 * Gemini accepts a subset of JSON Schema for tool arguments and rejects the whole request over anything else, so a
 * tool's schema is cut down to what it understands: unknown keys are dropped, a choice between shapes keeps its first.
 */
export function toGeminiSchema(schema: unknown, depth = 0): Record<string, unknown> {
  const s = (schema && typeof schema === "object" ? schema : {}) as Record<string, unknown>;
  const alternative = [s.anyOf, s.oneOf].find(Array.isArray) as unknown[] | undefined;
  if (depth < 8 && alternative?.length) {
    const first = alternative.find((a) => (a as { type?: unknown })?.type !== "null") ?? alternative[0];
    return toGeminiSchema(first, depth + 1);
  }
  const rawType = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  const type = typeof rawType === "string" && SCHEMA_TYPES.has(rawType) ? rawType : "string";
  const out: Record<string, unknown> = { type };
  if (typeof s.description === "string") out.description = s.description.slice(0, 400);
  if (Array.isArray(s.enum) && s.enum.every((e) => typeof e === "string")) out.enum = s.enum;
  if (type === "integer" || type === "number") {
    if (typeof s.minimum === "number") out.minimum = s.minimum;
    if (typeof s.maximum === "number") out.maximum = s.maximum;
  }
  if (type === "array") out.items = depth < 8 ? toGeminiSchema(s.items, depth + 1) : { type: "string" };
  if (type === "object") {
    const props = (s.properties && typeof s.properties === "object" ? s.properties : {}) as Record<
      string,
      unknown
    >;
    const names = Object.keys(props).slice(0, 40);
    out.properties = Object.fromEntries(
      names.map((k) => [k, depth < 8 ? toGeminiSchema(props[k], depth + 1) : { type: "string" }]),
    );
    const required = Array.isArray(s.required)
      ? s.required.filter((r) => typeof r === "string" && names.includes(r))
      : [];
    if (required.length > 0) out.required = required;
  }
  return out;
}

export function toGeminiTools(tools: ToolDeclaration[]) {
  return [
    {
      functionDeclarations: tools.map((t) => {
        const parameters = t.parameters ? toGeminiSchema(t.parameters) : undefined;
        const hasArgs =
          parameters && Object.keys((parameters.properties as object | undefined) ?? {}).length > 0;
        return {
          name: t.name,
          description: t.description.slice(0, 1000),
          ...(hasArgs ? { parameters } : {}),
        };
      }),
    },
  ];
}

export interface ChatRequest {
  apiKey: string;
  /** The model id without the "models/" prefix, e.g. "gemini-3.5-flash-lite". */
  model: string;
  system?: string;
  messages: ChatMessage[];
  /** Turns that follow the messages as Gemini sent them: the model's tool requests and the answers to them. */
  extra?: RawContent[];
  /** Tools the model may ask for. Leave out to make it answer in words. */
  tools?: ToolDeclaration[];
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Called with the running total each time the provider reports usage, so it survives a failure. */
  onUsage?: (usage: Usage) => void;
  fetchImpl?: typeof fetch;
  base?: string;
  /** Give up when nothing arrives for this long. */
  idleTimeoutMs?: number;
}

/** Gemini wants alternating turns that start with the user, so same-role neighbours are joined. */
export function toGeminiContents(messages: ChatMessage[]) {
  const out: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    const text = m.text.trim();
    if (!text) continue;
    const role = m.role === "assistant" ? "model" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push({ text });
    else out.push({ role, parts: [{ text }] });
  }
  while (out[0]?.role === "model") out.shift();
  return out.map((c) => ({ role: c.role, parts: [{ text: c.parts.map((p) => p.text).join("\n\n") }] }));
}

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

function usageFrom(meta: Record<string, unknown> | undefined): Usage | undefined {
  if (!meta) return undefined;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const reasoning = n(meta.thoughtsTokenCount);
  return {
    inputTokens: n(meta.promptTokenCount),
    cachedInputTokens: n(meta.cachedContentTokenCount),
    // Thinking is billed as output.
    outputTokens: n(meta.candidatesTokenCount) + reasoning,
    reasoningTokens: reasoning,
  };
}

/** Maps an HTTP failure to what happened, without ever echoing the key. */
export function chatErrorFromStatus(status: number): ChatError {
  if (status === 429) return new ChatError("rate_limited", true, `HTTP ${status}`);
  // Google answers 404 for a model it doesn't serve to this project (retired, or not offered to new users).
  if (status === 404) return new ChatError("model_refused", false, `HTTP ${status}`);
  if (status === 400 || status === 401 || status === 403)
    return new ChatError("provider_rejected", false, `HTTP ${status}`);
  if (status === 408 || status === 504) return new ChatError("timeout", true, `HTTP ${status}`);
  return new ChatError("overloaded", true, `HTTP ${status}`);
}

export async function* streamGemini(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const contents: Array<{ role: "user" | "model"; parts: RawPart[] }> = [
    ...toGeminiContents(req.messages),
    ...(req.extra ?? []),
  ];
  if (contents.length === 0) throw new ChatError("empty", false, "nothing to answer");

  const idle = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(), req.idleTimeoutMs ?? 30_000);
  };
  const signal = req.signal ? AbortSignal.any([req.signal, idle.signal]) : idle.signal;

  let usage: Usage = NO_USAGE;
  let sawText = false;
  let sawCall = false;
  const keep: RawPart[] = [];
  let finish: string | undefined;
  try {
    arm();
    let res: Response;
    try {
      res = await fetchImpl(`${req.base ?? GEMINI_BASE}/models/${req.model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "x-goog-api-key": req.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
          contents,
          ...(req.tools && req.tools.length > 0 ? { tools: toGeminiTools(req.tools) } : {}),
          generationConfig: { maxOutputTokens: req.maxOutputTokens },
        }),
        signal,
        redirect: "error",
      });
    } catch (error) {
      if (req.signal?.aborted) throw error;
      if (idle.signal.aborted) throw new ChatError("timeout", true, "no answer in time");
      throw new ChatError("unreachable", true, error instanceof Error ? error.name : "network error");
    }
    if (!res.ok) throw chatErrorFromStatus(res.status);
    if (!res.body) throw new ChatError("empty", false, "no body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (req.signal?.aborted) throw error;
        if (idle.signal.aborted) throw new ChatError("timeout", true, "stream stalled");
        throw new ChatError("unreachable", true, "stream broke");
      }
      if (chunk.done) break;
      arm();
      buffer += decoder.decode(chunk.value, { stream: true });
      // Events end at a blank line, which the real API writes as CRLF-CRLF.
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!data) continue;
        let json: {
          candidates?: Array<{
            content?: { parts?: Array<RawPart & { text?: string; thought?: boolean }> };
            finishReason?: string;
          }>;
          usageMetadata?: Record<string, unknown>;
          promptFeedback?: { blockReason?: string };
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const u = usageFrom(json.usageMetadata);
        if (u) {
          usage = u;
          req.onUsage?.(u);
        }
        if (json.promptFeedback?.blockReason)
          throw Object.assign(new ChatError("blocked", false, "prompt blocked"), { usage });
        const cand = json.candidates?.[0];
        for (const part of cand?.content?.parts ?? []) {
          const call = part.functionCall as { name?: unknown; args?: unknown } | undefined;
          if (call && typeof call.name === "string") {
            sawCall = true;
            keep.push(part);
            const args =
              call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
            yield { type: "call", call: { name: call.name, args } };
            continue;
          }
          // An empty part can carry the thought signature the next request must repeat, so it is kept.
          if (part.thoughtSignature) keep.push(part);
          if (part.thought || typeof part.text !== "string" || part.text === "") continue;
          if (!part.thoughtSignature) keep.push({ text: part.text });
          sawText = true;
          yield { type: "text", text: part.text };
        }
        if (cand?.finishReason) finish = cand.finishReason;
      }
    }
    if (finish && BLOCKED.has(finish)) throw new ChatError("blocked", false, finish);
    if (!sawText && !sawCall) throw new ChatError("empty", false, finish ?? "no text");
    yield { type: "done", finishReason: finish ?? "STOP", usage, parts: keep };
  } finally {
    clearTimeout(idleTimer);
  }
}
