/**
 * Talks to the Gemini API with a stored key: lists the models the key can use and probes every endpoint
 * family Orbs may need. Pure apart from the injected `fetch`, so it is tested without the network.
 * The key travels in a header, never in a URL, and never appears in any returned message.
 */
/** Google's API. A different base is only for tests against a local mock. */
export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 15_000;

export interface GeminiModel {
  /** Full resource name, e.g. "models/gemini-2.5-flash". */
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  methods: string[];
  /** False when the provider listed the model but refuses it for this project. Unset = not checked. */
  usable?: boolean;
}

export interface EndpointCheck {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  status: "ok" | "failed" | "skipped";
  httpStatus: number | null;
  ms: number | null;
  detail: string | null;
}

export type ModelsResult = { ok: true; models: GeminiModel[] } | { ok: false; error: string };

type Fetch = typeof fetch;

const clean = (text: string, key: string) => text.split(key).join("[key]").slice(0, 300);

async function errorText(res: Response, key: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return clean(body.error.message, key);
  } catch {
    // Not JSON.
  }
  return `HTTP ${res.status}`;
}

function call(
  key: string,
  fetchImpl: Fetch,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  base = GEMINI_BASE,
) {
  return fetchImpl(`${base}${path}`, {
    method,
    headers: { "x-goog-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
}

/** Every model the key can see, following pagination. */
export async function listGeminiModels(
  key: string,
  fetchImpl: Fetch = fetch,
  base = GEMINI_BASE,
): Promise<ModelsResult> {
  const models: GeminiModel[] = [];
  let token: string | undefined;
  try {
    for (let page = 0; page < 10; page++) {
      const res = await call(
        key,
        fetchImpl,
        "GET",
        `/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
        undefined,
        base,
      );
      if (!res.ok) return { ok: false, error: await errorText(res, key) };
      const body = (await res.json()) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          description?: string;
          inputTokenLimit?: number;
          outputTokenLimit?: number;
          supportedGenerationMethods?: string[];
        }>;
        nextPageToken?: string;
      };
      for (const m of body.models ?? []) {
        if (!m.name) continue;
        models.push({
          name: m.name,
          displayName: m.displayName ?? m.name,
          description: m.description ?? "",
          inputTokenLimit: m.inputTokenLimit ?? null,
          outputTokenLimit: m.outputTokenLimit ?? null,
          methods: m.supportedGenerationMethods ?? [],
        });
      }
      token = body.nextPageToken;
      if (!token) break;
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "Timed out"
          : "Could not reach the provider",
    };
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, models };
}

/** Models that generate something other than chat text, or are moving aliases, are never offered for chat. */
const NOT_CHAT =
  /(image|tts|transcribe|lyria|robotics|computer-use|deep-research|antigravity|omni|embedding|native-audio|live|imagen|veo|aqa|argon|nano-banana|customtools|-latest$)/i;

export function isChatCandidate(m: GeminiModel): boolean {
  return m.methods.includes("generateContent") && !NOT_CHAT.test(m.name);
}

export type ChatProbe = "usable" | "refused" | "unknown";

/**
 * Sends one tiny chat-shaped request (a system instruction and a few tokens) to see whether the model really
 * answers for this key. The list of models says what Google offers; this says what it serves to this project
 * (retired models, for example, are still listed but answer 404). A passing failure (quota, overload, timeout)
 * proves nothing, so it is "unknown" and the model stays visible.
 */
export async function probeChatModel(
  key: string,
  modelName: string,
  fetchImpl: Fetch = fetch,
  base = GEMINI_BASE,
): Promise<ChatProbe> {
  try {
    const res = await call(
      key,
      fetchImpl,
      "POST",
      `/${modelName}:generateContent`,
      {
        systemInstruction: { parts: [{ text: "Answer briefly." }] },
        contents: [{ role: "user", parts: [{ text: "ok" }] }],
        generationConfig: { maxOutputTokens: 8 },
      },
      base,
    );
    await res.body?.cancel();
    if (res.ok) return "usable";
    return [400, 403, 404].includes(res.status) ? "refused" : "unknown";
  } catch {
    return "unknown";
  }
}

/** Probes the chat candidates a few at a time and marks each model `usable` or not. Non-candidates are dropped. */
export async function usableChatModels(
  key: string,
  models: GeminiModel[],
  fetchImpl: Fetch = fetch,
  base = GEMINI_BASE,
  concurrency = 6,
): Promise<GeminiModel[]> {
  const candidates = models.filter(isChatCandidate);
  const out: GeminiModel[] = new Array(candidates.length);
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      const i = next++;
      const m = candidates[i] as GeminiModel;
      out[i] = { ...m, usable: (await probeChatModel(key, m.name, fetchImpl, base)) !== "refused" };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return out;
}

const STABLE = /^models\/gemini-([\d.]+)-(flash-lite|flash|pro)$/;
const TIER = { "flash-lite": 0, flash: 1, pro: 2 } as const;

/**
 * Models to try for generation, best first: stable Gemini models, cheapest tier first (lightest and usually
 * least busy), newest version first within a tier, then anything else that can generate. A model can be listed yet refused for this
 * project (for example "no longer available to new users"), so callers try several in turn.
 */
export function rankGenerationModels(models: GeminiModel[]): GeminiModel[] {
  const can = models.filter((m) => m.methods.includes("generateContent"));
  const stable = can
    .map((m) => ({ m, match: STABLE.exec(m.name) }))
    .filter((x): x is { m: GeminiModel; match: RegExpExecArray } => x.match !== null)
    .sort(
      (a, b) =>
        TIER[a.match[2] as keyof typeof TIER] - TIER[b.match[2] as keyof typeof TIER] ||
        Number.parseFloat(b.match[1] ?? "0") - Number.parseFloat(a.match[1] ?? "0"),
    )
    .map((x) => x.m);
  return [...stable, ...can.filter((m) => !stable.includes(m))];
}

export function pickGenerationModel(models: GeminiModel[]): GeminiModel | undefined {
  return rankGenerationModels(models)[0];
}

export function pickEmbeddingModel(models: GeminiModel[]): GeminiModel | undefined {
  return models.find((m) => m.methods.includes("embedContent"));
}

const PROMPT = {
  contents: [{ parts: [{ text: "Reply with the single word: OK" }] }],
  generationConfig: { maxOutputTokens: 16 },
};

type Probe = {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string | null;
  skip?: string;
  body?: unknown;
  stream?: boolean;
  /** HTTP statuses that mean "this API doesn't offer that to API keys" rather than "the key is bad". */
  unsupported?: number[];
};

async function runProbe(key: string, fetchImpl: Fetch, base: string, p: Probe): Promise<EndpointCheck> {
  const shown = p.path ? p.path.replace(/^\//, "/v1beta/") : `/v1beta/${p.id}`;
  const info = { id: p.id, label: p.label, method: p.method, path: shown.split("?")[0] ?? shown };
  if (!p.path) return { ...info, status: "skipped", httpStatus: null, ms: null, detail: p.skip ?? null };
  const started = Date.now();
  try {
    const res = await call(key, fetchImpl, p.method, p.path, p.body, base);
    const ms = Date.now() - started;
    if (!res.ok) {
      const detail = await errorText(res, key);
      if (p.unsupported?.includes(res.status))
        return {
          ...info,
          status: "skipped",
          httpStatus: res.status,
          ms,
          detail: `Not offered to API keys: ${detail}`,
        };
      return { ...info, status: "failed", httpStatus: res.status, ms, detail };
    }
    if (p.stream) {
      // Read the first chunk to prove the stream opens, then stop.
      const reader = res.body?.getReader();
      await reader?.read();
      await reader?.cancel().catch(() => undefined);
    } else {
      await res.arrayBuffer();
    }
    return { ...info, status: "ok", httpStatus: res.status, ms, detail: null };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "TimeoutError" ? "Timed out" : "Could not reach the provider";
    return { ...info, status: "failed", httpStatus: null, ms: Date.now() - started, detail };
  }
}

/**
 * Probes each endpoint family once with the smallest possible request (a few tokens at most).
 * "ok" means the API accepted the key for that endpoint; "failed" carries the provider's reason.
 * Generation is tried on up to five candidate models, because a listed model may be closed to this project.
 */
export async function checkGeminiEndpoints(
  key: string,
  models: GeminiModel[],
  fetchImpl: Fetch = fetch,
  base = GEMINI_BASE,
): Promise<EndpointCheck[]> {
  const candidates = rankGenerationModels(models).slice(0, 5);
  const emb = pickEmbeddingModel(models);

  // First find a model that really generates, so the other model endpoints are probed with a working one.
  let gen: GeminiModel | undefined = candidates[0];
  let generate: EndpointCheck | undefined;
  for (const candidate of candidates) {
    const result = await runProbe(key, fetchImpl, base, {
      id: "generateContent",
      label: "Generate content",
      method: "POST",
      path: `/${candidate.name}:generateContent`,
      body: PROMPT,
    });
    generate = result;
    gen = candidate;
    if (result.status === "ok") break;
    // Only a model-specific problem is worth another candidate (missing, refused, overloaded, timed out);
    // a bad key (401) or an exhausted quota (429) would fail them all alike.
    const modelSpecific =
      result.httpStatus === null || [400, 403, 404, 500, 502, 503, 504].includes(result.httpStatus);
    if (!modelSpecific) break;
  }
  const noModel = "No model supports it";
  const rest: Probe[] = [
    { id: "models.list", label: "List models", method: "GET", path: "/models?pageSize=1" },
    {
      id: "models.get",
      label: "Get a model",
      method: "GET",
      path: gen ? `/${gen.name}` : null,
      skip: "No model available",
    },
    {
      id: "streamGenerateContent",
      label: "Stream content",
      method: "POST",
      path: gen ? `/${gen.name}:streamGenerateContent?alt=sse` : null,
      skip: noModel,
      body: PROMPT,
      stream: true,
    },
    {
      id: "countTokens",
      label: "Count tokens",
      method: "POST",
      path: gen ? `/${gen.name}:countTokens` : null,
      skip: noModel,
      body: { contents: PROMPT.contents },
    },
    {
      id: "embedContent",
      label: "Embed content",
      method: "POST",
      path: emb ? `/${emb.name}:embedContent` : null,
      skip: "No embedding model available",
      body: { content: { parts: [{ text: "ping" }] } },
    },
    { id: "files.list", label: "List files", method: "GET", path: "/files?pageSize=1" },
    {
      id: "cachedContents.list",
      label: "List cached contents",
      method: "GET",
      path: "/cachedContents?pageSize=1",
    },
    // Tuned models are managed with OAuth; with an API key Google answers 501 even though the key is fine.
    {
      id: "tunedModels.list",
      label: "List tuned models",
      method: "GET",
      path: "/tunedModels?pageSize=1",
      unsupported: [501],
    },
  ];
  const results = await Promise.all(rest.map((p) => runProbe(key, fetchImpl, base, p)));
  const generateResult: EndpointCheck =
    generate ??
    ({
      id: "generateContent",
      label: "Generate content",
      method: "POST",
      path: "/v1beta/models/*:generateContent",
      status: "skipped",
      httpStatus: null,
      ms: null,
      detail: noModel,
    } as EndpointCheck);
  // Keep a stable, readable order.
  const order = [
    "models.list",
    "models.get",
    "generateContent",
    "streamGenerateContent",
    "countTokens",
    "embedContent",
    "files.list",
    "cachedContents.list",
    "tunedModels.list",
  ];
  return [...results, generateResult].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
