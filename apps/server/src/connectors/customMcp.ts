/**
 * MCP servers people add themselves. Everything here assumes the server is untrusted: its address is
 * checked against SSRF on every connection, redirects are refused, nothing it offers runs until the
 * owner switches that tool on, output is size-capped, and calls are rate limited and audited.
 */
import { randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { schema } from "@orbs/db";
import { and, count, eq } from "drizzle-orm";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { createRateLimiter } from "./rateLimit.ts";
import { ConnectorError } from "./service.ts";
import { assertSafeServerUrl, UnsafeUrlError } from "./urlGuard.ts";
import { aad, vault, vaultReady } from "./vault.ts";

export const MAX_SERVERS_PER_USER = 10;
const MAX_RESULT_CHARS = 100_000;
const limiter = createRateLimiter(env.ORBS_CONNECTOR_RATE_PER_MIN);

type Row = typeof schema.customMcpServer.$inferSelect;

export interface CustomServer {
  id: string;
  name: string;
  url: string;
  host: string;
  hasToken: boolean;
  allowedTools: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CustomTool {
  name: string;
  description: string;
  allowed: boolean;
  /** What the server claims about itself. Informational only: a server can lie, so it never grants access. */
  readOnlyHint: boolean | null;
  destructiveHint: boolean | null;
  inputSchema: Record<string, unknown> | null;
}

const toServer = (r: Row): CustomServer => ({
  id: r.id,
  name: r.name,
  url: r.url,
  host: new URL(r.url).host,
  hasToken: Boolean(r.tokenEnc),
  allowedTools: r.allowedTools,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
});

async function checkUrl(raw: string) {
  try {
    return await assertSafeServerUrl(raw, { allowPrivate: env.ORBS_ALLOW_PRIVATE_MCP_URLS });
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw new ConnectorError("unsafe_url", error.reason);
    throw error;
  }
}

export async function listServers(orgId: string, userId: string): Promise<CustomServer[]> {
  const rows = await db
    .select()
    .from(schema.customMcpServer)
    .where(and(eq(schema.customMcpServer.orgId, orgId), eq(schema.customMcpServer.userId, userId)))
    .orderBy(schema.customMcpServer.createdAt);
  return rows.map(toServer);
}

async function getRow(orgId: string, userId: string, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(schema.customMcpServer)
    .where(
      and(
        eq(schema.customMcpServer.id, id),
        eq(schema.customMcpServer.orgId, orgId),
        eq(schema.customMcpServer.userId, userId),
      ),
    )
    .limit(1);
  // Other people's servers look like missing ones.
  if (!row) throw new ConnectorError("not_connected");
  return row;
}

export async function addServer(
  orgId: string,
  userId: string,
  input: { name: string; url: string; token?: string },
): Promise<CustomServer> {
  const token = input.token?.trim();
  if (token && !vaultReady()) throw new ConnectorError("vault_missing");
  const url = await checkUrl(input.url);
  const [existing] = await db
    .select({ n: count() })
    .from(schema.customMcpServer)
    .where(and(eq(schema.customMcpServer.orgId, orgId), eq(schema.customMcpServer.userId, userId)));
  if ((existing?.n ?? 0) >= MAX_SERVERS_PER_USER) throw new ConnectorError("limit_reached");
  const id = randomUUID();
  try {
    const [row] = await db
      .insert(schema.customMcpServer)
      .values({
        id,
        orgId,
        userId,
        name: input.name.trim(),
        url: url.toString(),
        tokenEnc: token ? vault().encrypt(token, aad.customToken(id)) : null,
      })
      .returning();
    if (!row) throw new ConnectorError("upstream");
    await audit({
      orgId,
      actorId: userId,
      action: "custom-mcp.add",
      targetType: "custom-mcp",
      targetId: id,
      // Name and host only: the address may carry a path with an identifier, and the token is never logged.
      metadata: { name: row.name, host: url.host, hasToken: Boolean(token) },
    });
    return toServer(row);
  } catch (error) {
    // Drizzle wraps the driver error, so look at the cause as well.
    const code =
      (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
      (error as { code?: string })?.code;
    if (code === "23505") throw new ConnectorError("name_taken");
    throw error;
  }
}

export async function removeServer(orgId: string, userId: string, id: string) {
  const row = await getRow(orgId, userId, id);
  await db.delete(schema.customMcpServer).where(eq(schema.customMcpServer.id, row.id));
  limiter.forget(row.id);
  await audit({
    orgId,
    actorId: userId,
    action: "custom-mcp.remove",
    targetType: "custom-mcp",
    targetId: row.id,
    metadata: { name: row.name },
  });
}

async function withServer<T>(row: Row, fn: (client: Client) => Promise<T>): Promise<T> {
  // Checked on every connection, not just when added: DNS can change after the fact.
  const url = await checkUrl(row.url);
  const headers: Record<string, string> = {};
  if (row.tokenEnc)
    headers.Authorization = `Bearer ${vault().decrypt(row.tokenEnc, aad.customToken(row.id))}`;
  const client = new Client({ name: "orbs", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers },
    // A redirect could send the request (and the token) somewhere that was never checked.
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
  try {
    await client.connect(transport);
    return await fn(client);
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError("upstream", error instanceof Error ? error.message : undefined);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function listServerTools(orgId: string, userId: string, id: string): Promise<CustomTool[]> {
  const row = await getRow(orgId, userId, id);
  const result = await withServer(row, (client) => client.listTools());
  const allowed = new Set(row.allowedTools);
  return result.tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      allowed: allowed.has(tool.name),
      readOnlyHint: tool.annotations?.readOnlyHint ?? null,
      destructiveHint: tool.annotations?.destructiveHint ?? null,
      inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? null,
    }))
    .sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.name.localeCompare(b.name));
}

/** Switches exactly these tools on. Names the server doesn't currently offer are ignored. */
export async function setAllowedTools(orgId: string, userId: string, id: string, names: string[]) {
  const row = await getRow(orgId, userId, id);
  const offered = new Set((await withServer(row, (client) => client.listTools())).tools.map((t) => t.name));
  const allowed = [...new Set(names)].filter((n) => offered.has(n));
  await db
    .update(schema.customMcpServer)
    .set({ allowedTools: allowed })
    .where(eq(schema.customMcpServer.id, row.id));
  await audit({
    orgId,
    actorId: userId,
    action: "custom-mcp.allow",
    targetType: "custom-mcp",
    targetId: row.id,
    metadata: { name: row.name, allowed },
  });
  return allowed;
}

export async function runServerTool(
  orgId: string,
  userId: string,
  id: string,
  tool: string,
  args: Record<string, unknown>,
) {
  const row = await getRow(orgId, userId, id);
  if (!row.allowedTools.includes(tool)) throw new ConnectorError("tool_blocked", tool);
  if (!limiter.take(row.id).ok) throw new ConnectorError("rate_limited");
  const started = Date.now();
  let ok = false;
  try {
    const result = await withServer(row, (client) => client.callTool({ name: tool, arguments: args }));
    ok = true;
    const raw = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    const text = raw
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    return {
      text: text.slice(0, MAX_RESULT_CHARS),
      truncated: text.length > MAX_RESULT_CHARS,
      isError: Boolean((result as { isError?: boolean }).isError),
    };
  } finally {
    await db
      .update(schema.customMcpServer)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.customMcpServer.id, row.id));
    await audit({
      orgId,
      actorId: userId,
      action: "custom-mcp.call",
      targetType: "custom-mcp",
      targetId: row.id,
      metadata: { name: row.name, tool, ms: Date.now() - started, ok },
    });
  }
}
