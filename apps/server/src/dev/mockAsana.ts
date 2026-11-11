/**
 * A stand-in for Asana's OAuth server and MCP server, for tests and offline development.
 * It follows the same shape the real one advertises (path-inserted protected-resource metadata,
 * PKCE S256, client_secret_post, `iss` on the redirect) but never talks to Asana.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface MockAsanaOptions {
  port?: number;
  clientId: string;
  clientSecret: string;
  /** Access-token lifetime in seconds (short values exercise refresh). */
  accessTtl?: number;
  /** Issue a new refresh token on every refresh and invalidate the old one. */
  rotateRefresh?: boolean;
  /** Makes the token endpoint slow, to see what the screen shows while a connection is being finished. */
  tokenDelayMs?: number;
}

export interface MockAsana {
  url: string;
  mcpUrl: string;
  close(): Promise<void>;
  /** Test hooks. */
  stats: {
    tokenRequests: number;
    refreshRequests: number;
    revoked: number;
    toolCalls: string[];
    /** Requests to the REST API (`METHOD path?query`), used by token connections. */
    restCalls: string[];
  };
  /** Accepts this bearer token on the MCP endpoint (for testing servers added by hand). */
  allowToken(token: string): void;
  /** Makes every existing refresh token fail with invalid_grant, as if the user revoked access. */
  revokeAll(): void;
  /** Makes every existing access token fail with 401 without touching refresh tokens. */
  expireAccessTokens(): void;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("base64url");
const rand = () => randomBytes(24).toString("base64url");

export async function startMockAsana(opts: MockAsanaOptions): Promise<MockAsana> {
  const ttl = opts.accessTtl ?? 3600;
  const codes = new Map<string, { challenge: string; redirect: string; resource: string | null }>();
  const access = new Map<string, number>(); // token -> expiry ms
  const refresh = new Set<string>();
  const stats = {
    tokenRequests: 0,
    refreshRequests: 0,
    revoked: 0,
    toolCalls: [] as string[],
    restCalls: [] as string[],
  };
  let base = "";

  const mcp = createMcpHandler(() => {
    const server = new McpServer({ name: "mock-asana", version: "1.0.0" });
    const text = (t: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(t) }] });
    const track = (name: string) => stats.toolCalls.push(name);
    server.registerTool("get_me", { description: "Current user" }, async () => {
      track("get_me");
      // Like the real server: workspaces come by id only, with no name.
      return text({
        data: {
          gid: "1",
          name: "Mock Person",
          email: "mock@example.com",
          workspaces: [{ gid: "500", resource_type: "workspace" }],
        },
      });
    });
    server.registerTool(
      "get_user",
      {
        description: "A user",
        inputSchema: { user_id: z.string().optional(), opt_fields: z.string().optional() },
      },
      async ({ opt_fields }) => {
        track("get_user");
        const named = (opt_fields ?? "").includes("workspaces.name");
        return text({
          data: {
            gid: "1",
            name: "Mock Person",
            workspaces: [named ? { gid: "500", name: "Mock Workspace" } : { gid: "500" }],
          },
        });
      },
    );
    server.registerTool("get_my_tasks", { description: "My tasks" }, async () => {
      track("get_my_tasks");
      return text({ data: [{ name: "Write report", completed: false }] });
    });
    server.registerTool("create_tasks", { description: "Create tasks" }, async () => {
      track("create_tasks");
      return text({ ok: true });
    });
    server.registerTool("delete_task", { description: "Delete a task" }, async () => {
      track("delete_task");
      return text({ ok: true });
    });
    server.registerTool("create_task_preview", { description: "UI preview" }, async () => text({}));
    server.registerTool("brand_new_tool", { description: "Added later by the provider" }, async () =>
      text({}),
    );
    return server;
  });

  const readBody = (req: import("node:http").IncomingMessage) =>
    new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    });

  const json = (res: import("node:http").ServerResponse, status: number, body: unknown, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const http: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base || "http://localhost");
    const path = url.pathname;
    try {
      if (path.startsWith("/.well-known/oauth-protected-resource")) {
        return json(res, 200, {
          resource: `${base}/v2/mcp`,
          authorization_servers: [base],
          scopes_supported: ["default"],
        });
      }
      if (path === "/.well-known/oauth-authorization-server") {
        return json(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          revocation_endpoint: `${base}/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (path === "/authorize") {
        const q = url.searchParams;
        if (q.get("client_id") !== opts.clientId || q.get("code_challenge_method") !== "S256")
          return json(res, 400, { error: "invalid_request" });
        // Same shape as the code Asana shows on its "copy this code" page.
        const code = `2/1/${opts.clientId.length}:${randomBytes(16).toString("hex")}`;
        codes.set(code, {
          challenge: q.get("code_challenge") ?? "",
          redirect: q.get("redirect_uri") ?? "",
          resource: q.get("resource"),
        });
        // Like Asana's "out of band" address: no redirect, the page shows the code to copy.
        if ((q.get("redirect_uri") ?? "").startsWith("urn:")) {
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end(code);
        }
        const back = new URL(q.get("redirect_uri") ?? "");
        back.searchParams.set("code", code);
        back.searchParams.set("state", q.get("state") ?? "");
        back.searchParams.set("iss", base);
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (path === "/token" && req.method === "POST") {
        if (opts.tokenDelayMs) await new Promise((r) => setTimeout(r, opts.tokenDelayMs));
        const form = new URLSearchParams(await readBody(req));
        stats.tokenRequests++;
        if (form.get("client_id") !== opts.clientId || form.get("client_secret") !== opts.clientSecret)
          return json(res, 401, { error: "invalid_client" });
        const issue = (withRefresh: string | null) => {
          const token = rand();
          access.set(token, Date.now() + ttl * 1000);
          const next = withRefresh ?? rand();
          refresh.add(next);
          return { access_token: token, token_type: "bearer", expires_in: ttl, refresh_token: next };
        };
        if (form.get("grant_type") === "authorization_code") {
          const code = form.get("code") ?? "";
          const entry = codes.get(code);
          codes.delete(code);
          if (!entry) return json(res, 400, { error: "invalid_grant" });
          if (sha256(form.get("code_verifier") ?? "") !== entry.challenge)
            return json(res, 400, { error: "invalid_grant", error_description: "PKCE failed" });
          if (form.get("redirect_uri") !== entry.redirect) return json(res, 400, { error: "invalid_grant" });
          return json(res, 200, issue(null));
        }
        if (form.get("grant_type") === "refresh_token") {
          stats.refreshRequests++;
          const old = form.get("refresh_token") ?? "";
          if (!refresh.has(old)) return json(res, 400, { error: "invalid_grant" });
          if (opts.rotateRefresh !== false) refresh.delete(old);
          return json(res, 200, issue(opts.rotateRefresh === false ? old : null));
        }
        return json(res, 400, { error: "unsupported_grant_type" });
      }
      if (path === "/revoke" && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        if (refresh.delete(form.get("token") ?? "")) stats.revoked++;
        return json(res, 200, {});
      }
      if (path === "/v2/mcp") {
        const token = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
        const expiry = access.get(token);
        if (!expiry || expiry < Date.now()) {
          return json(
            res,
            401,
            { error: "invalid_token" },
            {
              "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/v2"`,
            },
          );
        }
        const body = req.method === "POST" ? await readBody(req) : undefined;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const response = await mcp.fetch(
          new Request(`${base}${req.url}`, { method: req.method, headers, body }),
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (path.startsWith("/api/1.0/")) {
        // Asana's REST API, which (unlike its MCP server) accepts a personal access token.
        const token = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
        const expiry = access.get(token);
        if (!expiry || expiry < Date.now())
          return json(res, 401, { errors: [{ message: "Not Authorized" }] });
        stats.restCalls.push(`${req.method} ${path.slice("/api/1.0".length)}${url.search}`);
        if (req.method !== "GET") return json(res, 405, { errors: [{ message: "read only" }] });
        const rest = path.slice("/api/1.0".length);
        if (rest === "/users/me")
          return json(res, 200, {
            data: {
              gid: "1",
              name: "Mock Person",
              email: "mock@example.com",
              workspaces: [
                { gid: "500", name: "Mock Workspace" },
                { gid: "501", name: "Second Org" },
              ],
            },
          });
        const inSecond = url.searchParams.get("workspace") === "501";
        if (rest === "/tasks") {
          const since = url.searchParams.get("completed_since");
          if (since && since !== "now") {
            // Finished tasks too: two pages in the first workspace, one in the second.
            const all = inSecond
              ? [
                  { gid: "41", completed: true, completed_at: "2026-05-01T09:00:00Z" },
                  { gid: "42", completed: true, completed_at: "2026-06-01T09:00:00Z" },
                ]
              : [
                  { gid: "31", completed: true, completed_at: "2026-03-10T10:00:00Z" },
                  { gid: "32", completed: true, completed_at: "2025-12-30T10:00:00Z" },
                  { gid: "33", completed: false },
                ];
            const start = url.searchParams.get("offset") === "o2" ? 2 : 0;
            return json(res, 200, {
              data: all.slice(start, start + 2),
              next_page: start + 2 < all.length ? { offset: "o2" } : null,
            });
          }
          return json(res, 200, {
            data: [inSecond ? { gid: "12", name: "Review budget" } : { gid: "11", name: "Write report" }],
          });
        }
        if (rest === "/projects")
          return json(res, 200, {
            data: [inSecond ? { gid: "22", name: "Audit" } : { gid: "21", name: "Launch plan" }],
          });
        if (/^\/tasks\/\d+$/.test(rest))
          return json(res, 200, {
            data: {
              gid: rest.split("/")[2],
              name: rest.endsWith("/12") ? "Review budget" : "Write report",
              notes: "Draft it",
              workspace: { gid: rest.endsWith("/12") ? "501" : "500" },
            },
          });
        if (/^\/workspaces\/\d+\/tasks\/search$/.test(rest))
          return json(res, 402, { errors: [{ message: "Search needs a paid plan" }] });
        return json(res, 404, { errors: [{ message: "Unknown resource" }] });
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      json(res, 500, { error: String(error) });
    }
  });

  await new Promise<void>((resolve) => http.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
  base = `http://127.0.0.1:${port}`;

  return {
    url: base,
    mcpUrl: `${base}/v2/mcp`,
    stats,
    allowToken: (token) => {
      access.set(token, Date.now() + 3_600_000);
    },
    revokeAll: () => refresh.clear(),
    expireAccessTokens: () => access.clear(),
    close: async () => {
      await mcp.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

// `pnpm --filter @orbs/server dev:mock-asana` — for trying the UI without a real Asana account.
if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockAsana({
    port: Number(process.env.MOCK_ASANA_PORT ?? 8799),
    clientId: process.env.MOCK_ASANA_CLIENT_ID ?? "mock-client",
    clientSecret: process.env.MOCK_ASANA_CLIENT_SECRET ?? "mock-secret",
    accessTtl: Number(process.env.MOCK_ASANA_TTL ?? 3600),
    tokenDelayMs: Number(process.env.MOCK_ASANA_TOKEN_DELAY_MS ?? 0),
  });
  // Lets the MCP endpoint be used as a hand-added server: MOCK_ASANA_TOKEN=secret pnpm dev:mock-asana
  if (process.env.MOCK_ASANA_TOKEN) mock.allowToken(process.env.MOCK_ASANA_TOKEN);
  console.log(`Mock Asana on ${mock.url}\nSet ORBS_ASANA_MCP_URL=${mock.mcpUrl}`);
}
