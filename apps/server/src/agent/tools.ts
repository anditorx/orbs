/**
 * The tools the assistant may use in a conversation: read-only actions from the apps the person connected.
 * Everything here goes through the connector service, which keeps its own rules (only read actions run, calls are
 * rate-limited and audited), so a model asking for something else gets a refusal instead of the action.
 */
import { schema } from "@orbs/db";
import { and, eq } from "drizzle-orm";
import { PROVIDERS } from "../connectors/providers.ts";
import { ConnectorError, listTools, runTool, type ToolInfo } from "../connectors/service.ts";
import { db } from "../db.ts";
import type { ToolCall, ToolDeclaration } from "./gemini.ts";

/** Most tools offered at once: every declaration is sent (and billed) with each step. */
export const MAX_TOOLS = 40;
/** Longest tool result handed to the model, in characters. */
export const MAX_RESULT_CHARS = 20_000;
const LIST_TTL_MS = 5 * 60_000;

type ConnectionRow = typeof schema.connection.$inferSelect;

export interface ToolRun {
  app: string;
  tool: string;
  ok: boolean;
  /** What the model gets back for its request. */
  response: Record<string, unknown>;
}

export interface Toolset {
  declarations: ToolDeclaration[];
  /** Which app and action a request is for, in words the person reads. */
  describe(name: string): { app: string; tool: string };
  run(call: ToolCall): Promise<ToolRun>;
}

export const EMPTY_TOOLSET: Toolset = {
  declarations: [],
  describe: (name) => ({ app: "", tool: name }),
  run: async (call) => ({
    app: "",
    tool: call.name,
    ok: false,
    response: { error: "That tool is not available." },
  }),
};

/** `asana__get_my_tasks` -> the provider and the tool in it. Names must be plain for Gemini, and unique across apps. */
const SEPARATOR = "__";
export const toolName = (provider: string, tool: string) => `${provider}${SEPARATOR}${tool}`.slice(0, 64);

const listed = new Map<string, { at: number; tools: ToolInfo[] }>();

async function toolsOf(conn: ConnectionRow): Promise<ToolInfo[]> {
  const key = `${conn.id}:${conn.updatedAt.getTime()}`;
  const hit = listed.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.tools;
  const tools = (await listTools(conn)).filter((t) => t.allowed && t.kind === "read");
  listed.set(key, { at: Date.now(), tools });
  return tools;
}

/** What the person is told when a tool didn't work, never a raw provider message. */
function failure(error: unknown): string {
  if (error instanceof ConnectorError) {
    switch (error.code) {
      case "needs_reauth":
      case "not_connected":
        return "The connection has expired or was removed. The person must reconnect the app under Customize → Connections.";
      case "rate_limited":
        return "Too many requests to this app right now. Try again in a moment.";
      case "tool_blocked":
        return "This action is not allowed: assistants may only read.";
      default:
        return "The app did not answer as expected.";
    }
  }
  return "The app did not answer as expected.";
}

/**
 * Builds the tools for one reply from the person's working connections. Listing an app's tools can fail (it may be
 * down); that app is simply left out, because a chat must still work without it.
 */
export async function loadToolset(orgId: string, userId: string): Promise<Toolset> {
  const conns = await db
    .select()
    .from(schema.connection)
    .where(
      and(
        eq(schema.connection.orgId, orgId),
        eq(schema.connection.userId, userId),
        eq(schema.connection.status, "active"),
      ),
    );
  const byName = new Map<string, { conn: ConnectionRow; tool: string; app: string }>();
  const declarations: ToolDeclaration[] = [];
  for (const conn of conns) {
    const provider = PROVIDERS[conn.provider];
    if (!provider) continue;
    let tools: ToolInfo[];
    try {
      tools = await toolsOf(conn);
    } catch (error) {
      console.error(
        "[agent tools] could not list",
        conn.provider,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    for (const tool of tools) {
      if (declarations.length >= MAX_TOOLS) break;
      const name = toolName(conn.provider, tool.name);
      byName.set(name, { conn, tool: tool.name, app: provider.name });
      declarations.push({
        name,
        description: `${provider.name}: ${tool.description}`.trim(),
        ...(tool.inputSchema ? { parameters: tool.inputSchema } : {}),
      });
    }
  }
  if (declarations.length === 0) return EMPTY_TOOLSET;

  return {
    declarations,
    describe: (name) => {
      const t = byName.get(name);
      return { app: t?.app ?? "", tool: t?.tool ?? name };
    },
    async run(call) {
      const target = byName.get(call.name);
      if (!target) {
        return { app: "", tool: call.name, ok: false, response: { error: "That tool is not available." } };
      }
      try {
        const out = await runTool(target.conn, target.tool, call.args);
        const text = out.text.length > MAX_RESULT_CHARS ? out.text.slice(0, MAX_RESULT_CHARS) : out.text;
        const cut = out.truncated || out.text.length > MAX_RESULT_CHARS;
        // The result is the app's data. The model is told never to treat it as instructions.
        return {
          app: target.app,
          tool: target.tool,
          ok: !out.isError,
          response: out.isError
            ? { error: text || "The app reported an error." }
            : { result: text, ...(cut ? { note: "The result was cut because it was too long." } : {}) },
        };
      } catch (error) {
        return { app: target.app, tool: target.tool, ok: false, response: { error: failure(error) } };
      }
    },
  };
}
