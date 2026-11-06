import { describe, expect, it } from "vitest";
import {
  checkGeminiEndpoints,
  type GeminiModel,
  isChatCandidate,
  listGeminiModels,
  pickEmbeddingModel,
  pickGenerationModel,
  probeChatModel,
  rankGenerationModels,
  usableChatModels,
} from "./geminiApi.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const model = (name: string, methods: string[]): GeminiModel => ({
  name,
  displayName: name,
  description: "",
  inputTokenLimit: 1,
  outputTokenLimit: 1,
  methods,
});

describe("listGeminiModels", () => {
  it("follows pagination, normalizes fields and sorts", async () => {
    const pages = [
      {
        models: [
          {
            name: "models/b",
            displayName: "B",
            inputTokenLimit: 10,
            supportedGenerationMethods: ["generateContent"],
          },
        ],
        nextPageToken: "t2",
      },
      { models: [{ name: "models/a" }] },
    ];
    let i = 0;
    const seen: string[] = [];
    const f = (async (url: Parameters<typeof fetch>[0]) => {
      seen.push(String(url));
      return json(pages[i++]);
    }) as typeof fetch;
    const out = await listGeminiModels("KEY", f);
    expect(out.ok && out.models.map((m) => m.name)).toEqual(["models/a", "models/b"]);
    expect(out.ok && out.models[1]).toMatchObject({
      displayName: "B",
      inputTokenLimit: 10,
      outputTokenLimit: null,
      methods: ["generateContent"],
    });
    expect(seen[1]).toContain("pageToken=t2");
    expect(seen.join("")).not.toContain("KEY");
  });
  it("reports the provider's reason without the key", async () => {
    const f = (async () => json({ error: { message: "bad KEY here" } }, 400)) as typeof fetch;
    const out = await listGeminiModels("KEY", f);
    expect(out).toEqual({ ok: false, error: "bad [key] here" });
  });
  it("survives network failure", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await listGeminiModels("k", f)).toEqual({ ok: false, error: "Could not reach the provider" });
  });
});

describe("model picking", () => {
  const models = [
    model("models/gemini-2.5-pro", ["generateContent"]),
    model("models/gemini-2.5-flash", ["generateContent"]),
    model("models/gemini-2.0-flash-lite", ["generateContent"]),
    model("models/gemini-embedding-001", ["embedContent"]),
    model("models/imagen", ["predict"]),
  ];
  it("ranks stable models cheapest tier first, newest version first within a tier", () => {
    expect(
      rankGenerationModels([...models, model("models/gemini-3.0-flash-lite", ["generateContent"])]).map(
        (m) => m.name,
      ),
    ).toEqual([
      "models/gemini-3.0-flash-lite",
      "models/gemini-2.0-flash-lite",
      "models/gemini-2.5-flash",
      "models/gemini-2.5-pro",
    ]);
    expect(pickGenerationModel(models)?.name).toBe("models/gemini-2.0-flash-lite");
    expect(pickGenerationModel([model("models/x", ["predict"])])).toBeUndefined();
  });
  it("finds an embedding model", () => {
    expect(pickEmbeddingModel(models)?.name).toBe("models/gemini-embedding-001");
  });
});

describe("checkGeminiEndpoints", () => {
  const models = [
    model("models/gemini-2.5-flash", ["generateContent"]),
    model("models/gemini-embedding-001", ["embedContent"]),
  ];

  it("probes every endpoint family and marks the good ones ok", async () => {
    const hits: string[] = [];
    const f = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      hits.push(`${init?.method} ${new URL(String(url)).pathname}`);
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("KEY");
      expect(String(url)).not.toContain("KEY");
      return String(url).includes("alt=sse") ? new Response("data: {}\n\n") : json({});
    }) as typeof fetch;
    const out = await checkGeminiEndpoints("KEY", models, f);
    expect(out.map((e) => e.id)).toEqual([
      "models.list",
      "models.get",
      "generateContent",
      "streamGenerateContent",
      "countTokens",
      "embedContent",
      "files.list",
      "cachedContents.list",
      "tunedModels.list",
    ]);
    expect(out.every((e) => e.status === "ok")).toBe(true);
    expect(hits).toContain("POST /v1beta/models/gemini-2.5-flash:generateContent");
    expect(hits).toContain("POST /v1beta/models/gemini-embedding-001:embedContent");
  });

  it("reports failures per endpoint with the provider's reason, and skips what has no model", async () => {
    const f = (async (url: Parameters<typeof fetch>[0]) =>
      String(url).includes("/files")
        ? json({ error: { message: "Files API disabled for KEY" } }, 403)
        : json({})) as typeof fetch;
    const out = await checkGeminiEndpoints("KEY", [model("models/gemini-2.5-flash", ["generateContent"])], f);
    const by = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(by["files.list"]).toMatchObject({
      status: "failed",
      httpStatus: 403,
      detail: "Files API disabled for [key]",
    });
    expect(by.embedContent).toMatchObject({ status: "skipped", detail: "No embedding model available" });
    expect(by.generateContent?.status).toBe("ok");
  });

  it("skips model endpoints when the key sees no models, and handles timeouts", async () => {
    const f = (async () => {
      const e = new Error("t");
      e.name = "TimeoutError";
      throw e;
    }) as typeof fetch;
    const out = await checkGeminiEndpoints("k", [], f);
    expect(out.find((e) => e.id === "generateContent")?.status).toBe("skipped");
    expect(out.find((e) => e.id === "models.list")).toMatchObject({ status: "failed", detail: "Timed out" });
  });
});

describe("checkGeminiEndpoints: real-world quirks", () => {
  const listed = [
    model("models/gemini-3.5-flash-lite", ["generateContent"]),
    model("models/gemini-2.5-flash-lite", ["generateContent"]),
    model("models/gemini-embedding-001", ["embedContent"]),
  ];

  it("falls back to another model when the first is listed but refused for this project", async () => {
    const f = (async (url: Parameters<typeof fetch>[0]) => {
      const u = String(url);
      if (
        u.includes("gemini-3.5-flash-lite") &&
        /:(generateContent|streamGenerateContent|countTokens)/.test(u)
      )
        return json({ error: { message: "This model is no longer available to new users." } }, 404);
      return u.includes("alt=sse") ? new Response("data: {}\n\n") : json({});
    }) as typeof fetch;
    const out = await checkGeminiEndpoints("KEY", listed, f);
    const by = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(by.generateContent).toMatchObject({
      status: "ok",
      path: "/v1beta/models/gemini-2.5-flash-lite:generateContent",
    });
    expect(by.streamGenerateContent?.status).toBe("ok");
    expect(by.countTokens?.status).toBe("ok");
  });

  it("reports generation as failed when every candidate is refused", async () => {
    const f = (async (url: Parameters<typeof fetch>[0]) =>
      /:generateContent/.test(String(url))
        ? json({ error: { message: "gone" } }, 404)
        : json({})) as typeof fetch;
    const out = await checkGeminiEndpoints("KEY", listed, f);
    expect(out.find((e) => e.id === "generateContent")).toMatchObject({
      status: "failed",
      httpStatus: 404,
      detail: "gone",
    });
  });

  it("moves on when a model is overloaded (503) or times out, since that is specific to the model", async () => {
    const f = (async (url: Parameters<typeof fetch>[0]) => {
      const u = String(url);
      if (u.includes("gemini-3.5-flash-lite:generateContent"))
        return json({ error: { message: "This model is currently experiencing high demand." } }, 503);
      return json({});
    }) as typeof fetch;
    const out = await checkGeminiEndpoints("KEY", listed, f);
    expect(out.find((e) => e.id === "generateContent")).toMatchObject({
      status: "ok",
      path: "/v1beta/models/gemini-2.5-flash-lite:generateContent",
    });
  });

  it("does not try other models when the key itself is the problem", async () => {
    let tries = 0;
    const f = (async (url: Parameters<typeof fetch>[0]) => {
      if (/:generateContent/.test(String(url))) {
        tries++;
        return json({ error: { message: "quota" } }, 429);
      }
      return json({});
    }) as typeof fetch;
    await checkGeminiEndpoints("KEY", listed, f);
    expect(tries).toBe(1);
  });

  it("treats HTTP 501 on tuned models as 'not offered to API keys', not as a failure", async () => {
    const f = (async (url: Parameters<typeof fetch>[0]) =>
      String(url).includes("/tunedModels")
        ? json({ error: { message: "Operation is not implemented" } }, 501)
        : json({})) as typeof fetch;
    const out = await checkGeminiEndpoints("KEY", listed, f);
    expect(out.find((e) => e.id === "tunedModels.list")).toMatchObject({
      status: "skipped",
      httpStatus: 501,
    });
    expect(out.filter((e) => e.status === "failed")).toEqual([]);
  });
});

describe("which models are offered for chat", () => {
  const gen = ["generateContent", "countTokens"];

  it("keeps text chat models and drops image, speech, embedding, alias and other special models", () => {
    const names = [
      ["models/gemini-3.5-flash-lite", true],
      ["models/gemini-3-flash-preview", true],
      ["models/gemini-3.1-pro-preview", true],
      ["models/gemini-2.5-flash-image", false],
      ["models/gemini-3.1-flash-tts-preview", false],
      ["models/gemini-3.5-transcribe", false],
      ["models/lyria-3-pro-preview", false],
      ["models/gemini-flash-latest", false],
      ["models/deep-research-pro-preview-12-2025", false],
      ["models/gemini-2.5-computer-use-preview-10-2025", false],
      ["models/antigravity-preview-05-2026", false],
      ["models/gemini-robotics-er-2-preview", false],
      ["models/gemini-nano-banana-2.1", false],
      ["models/nano-banana-pro-preview", false],
      ["models/gemini-3.1-pro-preview-customtools", false],
    ] as const;
    for (const [name, chat] of names) expect([name, isChatCandidate(model(name, gen))]).toEqual([name, chat]);
    expect(isChatCandidate(model("models/gemini-embedding-001", ["embedContent"]))).toBe(false);
  });

  const answer = (status: number) => (async () => new Response("{}", { status })) as typeof fetch;

  it("tells served models from refused ones; a passing failure doesn't hide a model", async () => {
    expect(await probeChatModel("k", "models/a", answer(200))).toBe("usable");
    expect(await probeChatModel("k", "models/a", answer(404))).toBe("refused");
    expect(await probeChatModel("k", "models/a", answer(403))).toBe("refused");
    expect(await probeChatModel("k", "models/a", answer(429))).toBe("unknown");
    expect(await probeChatModel("k", "models/a", answer(503))).toBe("unknown");
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await probeChatModel("k", "models/a", down)).toBe("unknown");
  });

  it("probes with a chat-shaped request, the key in a header only", async () => {
    let seen: { url: string; key: string | null; body: Record<string, unknown> } | undefined;
    const f = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen = {
        url: String(url),
        key: new Headers(init?.headers).get("x-goog-api-key"),
        body: JSON.parse(String(init?.body)),
      };
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await probeChatModel("SECRET", "models/gemini-3.5-flash", f);
    expect(seen?.url).toContain("/models/gemini-3.5-flash:generateContent");
    expect(seen?.url).not.toContain("SECRET");
    expect(seen?.key).toBe("SECRET");
    expect(seen?.body).toHaveProperty("systemInstruction");
  });

  it("marks each candidate usable or not and leaves the others out", async () => {
    const f = (async (url: Parameters<typeof fetch>[0]) =>
      new Response("{}", { status: String(url).includes("gemini-2.5") ? 404 : 200 })) as typeof fetch;
    const out = await usableChatModels(
      "k",
      [
        model("models/gemini-2.5-pro", gen),
        model("models/gemini-3.5-flash", gen),
        model("models/gemini-3-pro-image", gen),
        model("models/gemini-embedding-001", ["embedContent"]),
      ],
      f,
    );
    expect(out.map((m) => [m.name, m.usable])).toEqual([
      ["models/gemini-2.5-pro", false],
      ["models/gemini-3.5-flash", true],
    ]);
  });
});
