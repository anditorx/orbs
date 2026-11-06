import { describe, expect, it } from "vitest";
import {
  ChatError,
  type ChatEvent,
  streamGemini,
  toGeminiContents,
  toGeminiSchema,
  toGeminiTools,
} from "./gemini.ts";

const enc = new TextEncoder();

/** A streaming response whose bytes arrive in the given pieces, which may cut an event in half. */
function streamOf(pieces: string[], status = 200): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const p of pieces) controller.enqueue(enc.encode(p));
        controller.close();
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

const frame = (obj: unknown, sep = "\r\n\r\n") => `data: ${JSON.stringify(obj)}${sep}`;
const chunk = (text: string, usage?: Record<string, number>, finishReason?: string) =>
  frame({
    candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
    ...(usage ? { usageMetadata: usage } : {}),
  });

async function run(fetchImpl: typeof fetch, extra: Partial<Parameters<typeof streamGemini>[0]> = {}) {
  const events: ChatEvent[] = [];
  for await (const e of streamGemini({
    apiKey: "SECRET-KEY",
    model: "gemini-3.5-flash-lite",
    messages: [{ role: "user", text: "hi" }],
    maxOutputTokens: 100,
    fetchImpl,
    ...extra,
  }))
    events.push(e);
  return events;
}

const fail = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ChatError;
  }
};

describe("toGeminiContents", () => {
  it("joins same-role neighbours, drops empties, and starts with the user", () => {
    expect(
      toGeminiContents([
        { role: "assistant", text: "stray" },
        { role: "user", text: "a" },
        { role: "user", text: "  " },
        { role: "user", text: "b" },
        { role: "assistant", text: "c" },
      ]),
    ).toEqual([
      { role: "user", parts: [{ text: "a\n\nb" }] },
      { role: "model", parts: [{ text: "c" }] },
    ]);
  });
});

describe("streamGemini", () => {
  it("streams the text, takes usage from the LAST chunk (cumulative, not summed), and counts thinking as output", async () => {
    const f = (async () =>
      streamOf([
        chunk("Hel", { promptTokenCount: 9, candidatesTokenCount: 1 }),
        chunk("lo", {
          promptTokenCount: 9,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 5,
          cachedContentTokenCount: 3,
        }),
        chunk(
          "",
          { promptTokenCount: 9, candidatesTokenCount: 2, thoughtsTokenCount: 5, cachedContentTokenCount: 3 },
          "STOP",
        ),
      ])) as typeof fetch;
    const events = await run(f);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text)).toEqual([
      "Hel",
      "lo",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      finishReason: "STOP",
      usage: { inputTokens: 9, cachedInputTokens: 3, outputTokens: 7, reasoningTokens: 5 },
    });
  });

  it("reads events however the bytes are cut, and accepts LF-LF as well as CRLF-CRLF", async () => {
    const whole =
      chunk("Part one ") + chunk("and two", { promptTokenCount: 1, candidatesTokenCount: 4 }, "STOP");
    const cuts: string[] = [];
    for (let i = 0; i < whole.length; i += 7) cuts.push(whole.slice(i, i + 7));
    const text = (await run((async () => streamOf(cuts)) as typeof fetch))
      .filter((e) => e.type === "text")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(text).toBe("Part one and two");

    const lf =
      chunk("A", undefined, undefined).replace("\r\n\r\n", "\n\n") +
      frame(
        {
          candidates: [{ content: { parts: [{ text: "B" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
        },
        "\n\n",
      );
    const lfText = (await run((async () => streamOf([lf])) as typeof fetch))
      .filter((e) => e.type === "text")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(lfText).toBe("AB");
  });

  it("ignores thinking parts", async () => {
    const f = (async () =>
      streamOf([
        frame({
          candidates: [{ content: { parts: [{ text: "pondering", thought: true }, { text: "Answer" }] } }],
        }),
        chunk("", { promptTokenCount: 1, candidatesTokenCount: 1 }, "STOP"),
      ])) as typeof fetch;
    const events = await run(f);
    expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "Answer" }]);
  });

  it("sends the key in a header only, with the system prompt and conversation in the body", async () => {
    let seen: { url: string; key: string | null; body: Record<string, unknown> } | undefined;
    const f = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen = {
        url: String(url),
        key: new Headers(init?.headers).get("x-goog-api-key"),
        body: JSON.parse(String(init?.body)),
      };
      return streamOf([chunk("ok", { promptTokenCount: 1, candidatesTokenCount: 1 }, "STOP")]);
    }) as typeof fetch;
    await run(f, { system: "Be brief." });
    expect(seen?.key).toBe("SECRET-KEY");
    expect(seen?.url).not.toContain("SECRET-KEY");
    expect(seen?.url).toContain("models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
    expect(seen?.body.systemInstruction).toEqual({ parts: [{ text: "Be brief." }] });
    expect(seen?.body.generationConfig).toEqual({ maxOutputTokens: 100 });
  });

  it.each([
    [429, "rate_limited", true],
    [503, "overloaded", true],
    [500, "overloaded", true],
    [404, "model_refused", false],
    [403, "provider_rejected", false],
    [400, "provider_rejected", false],
  ] as const)(
    "maps HTTP %i to %s (transient: %s) without leaking the key",
    async (status, code, transient) => {
      const err = await fail(run((async () => new Response("{}", { status })) as typeof fetch));
      expect(err).toBeInstanceOf(ChatError);
      expect(err).toMatchObject({ code, transient });
      expect(String(err?.message)).not.toContain("SECRET-KEY");
    },
  );

  it("reports a blocked answer, whether the prompt or the reply was refused", async () => {
    const reply = await fail(
      run((async () =>
        streamOf([
          chunk("partial", { promptTokenCount: 1, candidatesTokenCount: 1 }, "SAFETY"),
        ])) as typeof fetch),
    );
    expect(reply).toMatchObject({ code: "blocked", transient: false });
    const prompt = await fail(
      run((async () =>
        streamOf([frame({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })])) as typeof fetch),
    );
    expect(prompt).toMatchObject({ code: "blocked" });
  });

  it("treats a finished stream with no text as an empty answer", async () => {
    const err = await fail(
      run((async () =>
        streamOf([chunk("", { promptTokenCount: 1, candidatesTokenCount: 0 }, "STOP")])) as typeof fetch),
    );
    expect(err).toMatchObject({ code: "empty", transient: false });
  });

  it("reports an unreachable provider as worth retrying", async () => {
    const err = await fail(
      run((async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch),
    );
    expect(err).toMatchObject({ code: "unreachable", transient: true });
  });

  it("gives up when nothing arrives in time", async () => {
    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError")),
            );
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    const err = await fail(run(hang, { idleTimeoutMs: 30 }));
    expect(err).toMatchObject({ code: "timeout", transient: true });
  });

  it("stops when the caller cancels, and the usage seen so far was already reported", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const f = (async (_u: unknown, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(chunk("first", { promptTokenCount: 9, candidatesTokenCount: 3 })));
            init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    const iterator = streamGemini({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", text: "hi" }],
      maxOutputTokens: 10,
      fetchImpl: f,
      signal: controller.signal,
      onUsage: (u) => seen.push(u.outputTokens),
    });
    const first = await iterator.next();
    expect(first.value).toEqual({ type: "text", text: "first" });
    controller.abort();
    const err = await fail(iterator.next());
    expect(err).not.toBeInstanceOf(ChatError);
    expect(seen).toEqual([3]);
  });

  it("refuses to call the provider with nothing to answer", async () => {
    const err = await fail(
      run((async () => streamOf([])) as typeof fetch, { messages: [{ role: "assistant", text: "x" }] }),
    );
    expect(err).toMatchObject({ code: "empty" });
  });
});

describe("tools", () => {
  it("cuts a tool's JSON Schema down to what Gemini accepts", () => {
    const out = toGeminiSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many" },
        mode: { type: "string", enum: ["a", "b"], default: "a" },
        due: { anyOf: [{ type: "null" }, { type: "string", format: "date" }] },
        tags: { type: "array", items: { type: ["string", "null"] } },
        weird: { $ref: "#/definitions/x" },
      },
      required: ["limit", "missing"],
    });
    expect(out).toEqual({
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many" },
        mode: { type: "string", enum: ["a", "b"] },
        due: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        weird: { type: "string" },
      },
      required: ["limit"],
    });
  });

  it("declares a tool without arguments with no parameters at all", () => {
    const [group] = toGeminiTools([
      { name: "get_me", description: "Who", parameters: { type: "object", properties: {} } },
      {
        name: "find",
        description: "Look",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    const [noArgs, withArgs] = group?.functionDeclarations ?? [];
    expect(noArgs).toEqual({ name: "get_me", description: "Who" });
    expect(withArgs?.parameters).toEqual({ type: "object", properties: { q: { type: "string" } } });
  });

  const callFrame = (name: string, extra: Record<string, unknown> = {}) =>
    frame({
      candidates: [
        {
          content: { role: "model", parts: [{ functionCall: { name, args: { limit: 3 } }, ...extra }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
    });

  it("reports a tool request, keeps the part with its thought signature, and needs no text", async () => {
    const f = (async () =>
      streamOf([callFrame("asana__get_my_tasks", { thoughtSignature: "SIG" })])) as typeof fetch;
    const events = await run(f);
    expect(events.filter((e) => e.type === "call")).toEqual([
      { type: "call", call: { name: "asana__get_my_tasks", args: { limit: 3 } } },
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", usage: { inputTokens: 7, outputTokens: 2 } });
    const parts = (done as { parts: unknown[] }).parts;
    expect(parts).toEqual([
      { functionCall: { name: "asana__get_my_tasks", args: { limit: 3 } }, thoughtSignature: "SIG" },
    ]);
  });

  it("keeps a signature that arrives on an empty text part", async () => {
    const f = (async () =>
      streamOf([
        chunk("Hi"),
        frame({
          candidates: [
            { content: { parts: [{ text: "", thoughtSignature: "LATE" }] }, finishReason: "STOP" },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      ])) as typeof fetch;
    const done = (await run(f)).at(-1) as { parts: unknown[] };
    expect(done.parts).toEqual([{ text: "Hi" }, { text: "", thoughtSignature: "LATE" }]);
  });

  it("sends the tools, and the earlier tool turns after the conversation", async () => {
    let body: Record<string, unknown> = {};
    const f = (async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return streamOf([chunk("done", { promptTokenCount: 1, candidatesTokenCount: 1 }, "STOP")]);
    }) as typeof fetch;
    await run(f, {
      tools: [{ name: "get_me", description: "Who" }],
      extra: [
        { role: "model", parts: [{ functionCall: { name: "get_me", args: {} }, thoughtSignature: "S" }] },
        { role: "user", parts: [{ functionResponse: { name: "get_me", response: { result: "Mock" } } }] },
      ],
    });
    expect(JSON.stringify(body.tools)).toContain("get_me");
    const contents = body.contents as Array<{ role: string }>;
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(JSON.stringify(contents[1])).toContain("thoughtSignature");
  });

  it("sends no tools when none are offered", async () => {
    let body: Record<string, unknown> = {};
    const f = (async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return streamOf([chunk("ok", { promptTokenCount: 1, candidatesTokenCount: 1 }, "STOP")]);
    }) as typeof fetch;
    await run(f);
    expect(body.tools).toBeUndefined();
  });
});
