/**
 * Connector providers and their tool policy. Pure data and functions (no environment, no database),
 * so the rules can be tested in isolation.
 *
 * Why Orbs classifies tools itself: Asana's MCP authorization has no scopes, so one grant can reach
 * every tool, including destructive ones and any added later. Orbs is the only gatekeeper.
 */
export type ToolKind = "read" | "write" | "destructive" | "interactive" | "unknown";

export interface ConnectorProvider {
  id: string;
  name: string;
  /** Production MCP endpoint (Streamable HTTP). */
  mcpUrl: string;
  classify(tool: string): ToolKind;
}

const asanaRead = new Set([
  "search_objects",
  "get_task",
  "get_task_stories",
  "get_tasks",
  "get_my_tasks",
  "get_notifications",
  "search_tasks",
  "get_project",
  "get_projects",
  "get_portfolio",
  "get_portfolios",
  "get_items_for_portfolio",
  "get_status_overview",
  "get_attachments",
  "get_user",
  "get_me",
  "get_users",
  "get_teams",
  "get_agent",
  "get_workspace_agents",
  "get_table",
  "get_tables",
  "get_record",
  "get_records",
  "search_records",
]);

const asanaWrite = new Set([
  "create_tasks",
  "create_project",
  "create_task_from_template",
  "create_project_from_template",
  "update_project",
  "update_tasks",
  "update_notifications",
  "add_comment",
  "create_project_status_update",
  "create_table",
  "update_table",
  "create_records",
  "update_records",
  "add_record_comment",
]);

const asanaDestructive = new Set(["delete_task", "delete_record"]);

// UI-only helpers for clients that render previews; they have no use inside Orbs.
const asanaInteractive = new Set(["create_task_preview", "create_project_preview", "search_tasks_preview"]);

export const asana: ConnectorProvider = {
  id: "asana",
  name: "Asana",
  mcpUrl: "https://mcp.asana.com/v2/mcp",
  classify(tool) {
    if (asanaRead.has(tool)) return "read";
    if (asanaDestructive.has(tool)) return "destructive";
    if (asanaWrite.has(tool)) return "write";
    if (asanaInteractive.has(tool)) return "interactive";
    // A tool Orbs has never seen (the provider may add tools at any time) stays blocked until reviewed.
    return "unknown";
  },
};

export const PROVIDERS: Record<string, ConnectorProvider> = { asana };

/** The "no redirect" address: the provider shows a code on its own page and the person pastes it into Orbs. */
export const OOB_REDIRECT = "urn:ietf:wg:oauth:2.0:oob";

/** Where the provider sends the person back to, so they land in Orbs with no copying. */
export function redirectUriFor(webUrl: string): string {
  return `${webUrl.replace(/\/$/, "")}/api/connections/oauth/callback`;
}

export function providerById(id: string): ConnectorProvider | undefined {
  return PROVIDERS[id];
}

/** Only read-only tools may run. Writes need a human approval flow that doesn't exist yet. */
export function isKindAllowed(kind: ToolKind): boolean {
  return kind === "read";
}

export function isToolAllowed(provider: ConnectorProvider, tool: string): boolean {
  return isKindAllowed(provider.classify(tool));
}

export interface AccountInfo {
  name: string | null;
  email: string | null;
  workspaces: string[];
}

/**
 * Reads the account out of a `get_me` result. The exact shape of Asana's response isn't documented,
 * so this accepts a JSON text block with common field names and returns nulls instead of failing.
 */
export function parseAccount(text: string | undefined): AccountInfo {
  const empty: AccountInfo = { name: null, email: null, workspaces: [] };
  if (!text) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const root = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const source = (
    typeof root.data === "object" && root.data ? (root.data as Record<string, unknown>) : root
  ) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const rawSpaces = source.workspaces ?? source.workspace_memberships ?? [];
  const workspaces = (Array.isArray(rawSpaces) ? rawSpaces : [])
    .map((w) => {
      const o = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
      const inner = (typeof o.workspace === "object" && o.workspace ? o.workspace : o) as Record<
        string,
        unknown
      >;
      return str(inner.name);
    })
    .filter((n): n is string => n !== null);
  return { name: str(source.name), email: str(source.email), workspaces };
}

/** The first text block of a tool result. */
const textOf = (result: unknown): string | undefined =>
  (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content?.find(
    (c) => c.type === "text",
  )?.text;

/**
 * Who the account is. Asana's MCP `get_me` lists workspaces by id only, so a missing name is looked up with `get_user`,
 * which returns it when the field is named. A failure in that second step leaves the workspace unnamed, nothing more.
 */
export async function readAccount(ask: (tool: string, args: Record<string, unknown>) => Promise<unknown>) {
  const account = parseAccount(textOf(await ask("get_me", {})));
  if (account.workspaces.length > 0) return account;
  try {
    const named = parseAccount(
      textOf(await ask("get_user", { user_id: "me", opt_fields: "name,email,workspaces.name" })),
    );
    return { ...account, workspaces: named.workspaces };
  } catch {
    return account;
  }
}
