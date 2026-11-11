/**
 * Asana through its ordinary REST API, for people who connect with a personal access token.
 *
 * Why this exists: Asana's MCP server only accepts tokens issued by its OAuth flow ("token was not issued by
 * Asana OAuth"), so a personal access token can't be used there. The REST API does accept it, so for token
 * connections Orbs offers its own small set of tools on top of the REST API. They are read-only by construction:
 * every request here is a GET, and nothing a tool receives can change which address or method is used.
 * Pure apart from the injected `fetch`, so it is tested without the network.
 */

export const ASANA_API = "https://app.asana.com/api/1.0";
const TIMEOUT_MS = 15_000;
const MAX_LIMIT = 50;

/** Asana refused the token (revoked, expired, or never valid). The caller asks the person for a new one. */
export class AsanaUnauthorized extends Error {}

export interface RestToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const workspaceProp = {
  type: "string",
  description: "Workspace name or ID. Leave empty to cover all of the account's workspaces.",
};
const limitProp = {
  type: "integer",
  minimum: 1,
  maximum: MAX_LIMIT,
  description: "How many to return (up to 50).",
};

export const ASANA_REST_TOOLS: RestToolDef[] = [
  {
    name: "get_me",
    description: "The account behind this token, with its workspaces.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_my_tasks",
    description:
      "Tasks assigned to you, from every workspace unless one is named; each group says which workspace it is from. " +
      'By default only unfinished ones. Set status to "completed" or "all" (with since) to include finished tasks. ' +
      "To COUNT finished tasks use count_completed_tasks instead: this returns one page only.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: workspaceProp,
        limit: limitProp,
        status: {
          type: "string",
          enum: ["open", "completed", "all"],
          description: "open (default): unfinished. completed: finished since the date. all: both.",
        },
        since: {
          type: "string",
          description:
            "For completed or all: only tasks finished on or after this date (YYYY-MM-DD). Defaults to 90 days ago.",
        },
      },
    },
  },
  {
    name: "count_completed_tasks",
    description:
      "How many tasks assigned to you were completed in a period, counted over all of them (not one page), in every workspace unless one is named. " +
      'Use it for questions like "how many tasks did I finish this year". Dates are in UTC.',
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Count tasks completed on or after this date (YYYY-MM-DD)." },
        until: {
          type: "string",
          description: "Count tasks completed before this date (YYYY-MM-DD). Leave empty for up to now.",
        },
        workspace: workspaceProp,
      },
      required: ["since"],
    },
  },
  {
    name: "list_projects",
    description:
      "Projects that are not archived, from every workspace unless one is named. Each group says which workspace it is from.",
    inputSchema: { type: "object", properties: { workspace: workspaceProp, limit: limitProp } },
  },
  {
    name: "get_task",
    description: "One task: its description, assignee, due date and projects.",
    inputSchema: {
      type: "object",
      properties: { task_gid: { type: "string", description: "Task ID (digits only)." } },
      required: ["task_gid"],
    },
  },
  {
    name: "search_tasks",
    description:
      "Find tasks by words in their name or description, in every workspace unless one is named (Asana offers this on paid plans only).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Words to look for." },
        workspace: workspaceProp,
        limit: limitProp,
      },
      required: ["text"],
    },
  },
];

export const isAsanaRestTool = (name: string) => ASANA_REST_TOOLS.some((t) => t.name === name);

type Fetch = typeof fetch;
export interface RestContext {
  token: string;
  base?: string;
  fetchImpl?: Fetch;
  /** Workspace ids the person allowed. Absent or null means every workspace the account has. */
  allowedWorkspaces?: string[] | null;
}

export interface RestResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

const ok = (data: unknown): RestResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  isError: false,
});
const fail = (message: string): RestResult => ({ content: [{ type: "text", text: message }], isError: true });

/** An argument that ends up in a URL path or query: digits only, so it can't change where the request goes. */
const gidOf = (value: unknown): string | null =>
  typeof value === "string" && /^\d{1,30}$/.test(value.trim()) ? value.trim() : null;

const limitOf = (value: unknown): number => {
  const n = typeof value === "number" ? Math.trunc(value) : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : 20;
};

/** What Asana said was wrong, in one short line (never the token, never raw markup). */
async function asanaMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: Array<{ message?: string }> };
    const text = body.errors?.[0]?.message;
    if (text) return text.slice(0, 300);
  } catch {
    // Not JSON.
  }
  return `Asana answered HTTP ${res.status}.`;
}

/** One GET. Returns the `data` Asana sent, or a failure to show; throws only when the token is refused. */
async function get(
  ctx: RestContext,
  path: string,
  params: Record<string, string>,
): Promise<{ data: unknown; next?: string } | { error: string }> {
  const url = new URL(`${ctx.base ?? ASANA_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await (ctx.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { authorization: `Bearer ${ctx.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    return { error: "Could not reach Asana." };
  }
  if (res.status === 401) throw new AsanaUnauthorized();
  if (!res.ok) return { error: await asanaMessage(res) };
  try {
    const body = (await res.json()) as { data?: unknown; next_page?: { offset?: unknown } | null };
    const next = body.next_page?.offset;
    return { data: body.data ?? null, ...(typeof next === "string" && next ? { next } : {}) };
  } catch {
    return { error: "Asana sent something unreadable." };
  }
}

interface Workspace {
  gid: string;
  name: string;
}

/** Most workspaces looked at in one request: each is a request of its own. */
const MAX_WORKSPACES = 8;

/** Every workspace the account has, as Asana lists them, whatever the person allowed. Ids come from Asana only. */
export async function listAllWorkspaces(ctx: RestContext): Promise<Workspace[] | { error: string }> {
  const me = await get(ctx, "/users/me", { opt_fields: "workspaces.name" });
  if ("error" in me) return me;
  const raw = (me.data as { workspaces?: Array<{ gid?: unknown; name?: unknown }> } | null)?.workspaces ?? [];
  return raw
    .filter(
      (w): w is { gid: string; name?: unknown } => typeof w.gid === "string" && /^\d{1,30}$/.test(w.gid),
    )
    .map((w) => ({ gid: w.gid, name: typeof w.name === "string" && w.name ? w.name : w.gid }));
}

/** The workspaces the assistant may use: those the person allowed, or all when they never chose. */
async function workspacesOf(ctx: RestContext): Promise<Workspace[] | { error: string }> {
  const all = await listAllWorkspaces(ctx);
  if ("error" in all || !ctx.allowedWorkspaces) return all;
  const allowed = new Set(ctx.allowedWorkspaces);
  return all.filter((w) => allowed.has(w.gid));
}

/**
 * Which workspaces a request covers: the one asked for (by name or ID), or every workspace the account has. A person
 * with several workspaces who asks "my tasks" means all of them, so that is the default.
 */
async function workspacesFor(ctx: RestContext, asked: unknown): Promise<Workspace[] | { error: string }> {
  const all = await workspacesOf(ctx);
  if ("error" in all) return all;
  if (all.length === 0) {
    return {
      error: ctx.allowedWorkspaces
        ? "None of the workspaces the person chose for Orbs is available any more."
        : "This account has no workspace.",
    };
  }
  const wanted = typeof asked === "string" || typeof asked === "number" ? String(asked).trim() : "";
  if (!wanted) return all.slice(0, MAX_WORKSPACES);
  const lower = wanted.toLowerCase();
  const hit =
    all.filter((w) => w.gid === wanted).length > 0
      ? all.filter((w) => w.gid === wanted)
      : all.filter((w) => w.name.toLowerCase() === lower).length > 0
        ? all.filter((w) => w.name.toLowerCase() === lower)
        : all.filter((w) => w.name.toLowerCase().includes(lower));
  if (hit.length > 0) return hit;
  return {
    error: `No workspace matches "${wanted.slice(0, 80)}". This account has: ${all.map((w) => w.name).join(", ")}.`,
  };
}

/** Runs a request in each chosen workspace and labels each answer with its workspace. */
async function inWorkspaces(
  ctx: RestContext,
  asked: unknown,
  run: (w: Workspace) => Promise<{ data: unknown } | { error: string }>,
): Promise<RestResult> {
  const chosen = await workspacesFor(ctx, asked);
  if ("error" in chosen) return fail(chosen.error);
  const groups: Array<{ workspace: string; workspace_gid: string; data?: unknown; error?: string }> = [];
  for (const w of chosen) {
    const r = await run(w);
    groups.push({
      workspace: w.name,
      workspace_gid: w.gid,
      ...("error" in r ? { error: r.error } : { data: r.data }),
    });
  }
  // Failing everywhere is a failure; failing in one workspace (say a free plan) just says so for that one.
  const first = groups[0];
  if (first && groups.every((g) => g.error !== undefined)) return fail(first.error ?? "Asana refused.");
  return ok(groups);
}

const TASK_FIELDS = "name,due_on,completed,completed_at,permalink_url,projects.name,assignee.name";

/** A date the model gave, as an ISO moment, or null when it isn't a real date in a sensible range. */
function dateOf(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/.test(value.trim())) return null;
  const at = new Date(value.trim().length === 10 ? `${value.trim()}T00:00:00Z` : value.trim());
  const year = at.getUTCFullYear();
  return Number.isNaN(at.getTime()) || year < 2000 || year > 2100 ? null : at.toISOString();
}

/** Pages read when counting: 100 tasks each, so up to 3,000 tasks per workspace before it says the count is a floor. */
const MAX_COUNT_PAGES = 30;

/** Counts the tasks the account finished in a period in one workspace, reading every page. */
async function countCompleted(
  ctx: RestContext,
  w: Workspace,
  since: string,
  until: string | null,
): Promise<{ completed: number; by_month: Record<string, number>; at_least?: true } | { error: string }> {
  const from = Date.parse(since);
  const to = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
  const byMonth: Record<string, number> = {};
  let completed = 0;
  let offset: string | undefined;
  let pages = 0;
  do {
    const page = await get(ctx, "/tasks", {
      assignee: "me",
      workspace: w.gid,
      // Asana returns unfinished tasks and those finished since this moment; the finished ones are filtered below.
      completed_since: since,
      limit: "100",
      opt_fields: "completed,completed_at",
      ...(offset ? { offset } : {}),
    });
    if ("error" in page) return page;
    for (const t of (Array.isArray(page.data) ? page.data : []) as Array<{
      completed?: boolean;
      completed_at?: string;
    }>) {
      const at = t.completed === true && t.completed_at ? Date.parse(t.completed_at) : Number.NaN;
      if (Number.isNaN(at) || at < from || at >= to) continue;
      completed++;
      const month = (t.completed_at as string).slice(0, 7);
      byMonth[month] = (byMonth[month] ?? 0) + 1;
    }
    offset = page.next;
    pages++;
  } while (offset && pages < MAX_COUNT_PAGES);
  return { completed, by_month: byMonth, ...(offset ? { at_least: true as const } : {}) };
}

/** Runs one tool. Never throws except `AsanaUnauthorized`; every other problem comes back as an error result. */
export async function callAsanaRest(
  tool: string,
  args: Record<string, unknown>,
  ctx: RestContext,
): Promise<RestResult> {
  const answer = (r: { data: unknown } | { error: string }) => ("error" in r ? fail(r.error) : ok(r.data));
  switch (tool) {
    case "get_me": {
      const me = await get(ctx, "/users/me", { opt_fields: "name,email,workspaces.name" });
      if ("error" in me || !ctx.allowedWorkspaces) return answer(me);
      // Only the workspaces the person allowed are shown, so the model doesn't learn of (or ask for) the others.
      const allowed = new Set(ctx.allowedWorkspaces);
      const data = (me.data ?? {}) as { workspaces?: Array<{ gid?: string }> };
      return ok({ ...data, workspaces: (data.workspaces ?? []).filter((w) => w.gid && allowed.has(w.gid)) });
    }
    case "get_my_tasks": {
      const status = args.status === "completed" || args.status === "all" ? args.status : "open";
      const since =
        status === "open"
          ? null
          : (dateOf(args.since) ?? new Date(Date.now() - 90 * 86_400_000).toISOString());
      if (status !== "open" && args.since !== undefined && args.since !== "" && !dateOf(args.since)) {
        return fail("since must be a date such as 2026-01-01.");
      }
      return inWorkspaces(ctx, args.workspace, async (w) => {
        const r = await get(ctx, "/tasks", {
          assignee: "me",
          workspace: w.gid,
          completed_since: since ?? "now",
          limit: String(limitOf(args.limit)),
          opt_fields: TASK_FIELDS,
        });
        if ("error" in r || status !== "completed" || !Array.isArray(r.data)) return r;
        // Asana also returns unfinished tasks for this filter; "completed" means only the finished ones.
        const from = Date.parse(since as string);
        return {
          data: (r.data as Array<{ completed?: boolean; completed_at?: string }>).filter(
            (t) => t.completed === true && Date.parse(t.completed_at ?? "") >= from,
          ),
        };
      });
    }
    case "count_completed_tasks": {
      const since = dateOf(args.since);
      if (!since) return fail("since is required and must be a date such as 2026-01-01.");
      const until = args.until === undefined || args.until === "" ? null : dateOf(args.until);
      if (args.until !== undefined && args.until !== "" && !until)
        return fail("until must be a date such as 2026-12-31.");
      if (until && Date.parse(until) <= Date.parse(since)) return fail("until must be after since.");
      const chosen = await workspacesFor(ctx, args.workspace);
      if ("error" in chosen) return fail(chosen.error);
      const groups: Array<Record<string, unknown>> = [];
      let total = 0;
      let anyFloor = false;
      let anyFailed = false;
      for (const w of chosen) {
        const r = await countCompleted(ctx, w, since, until);
        if ("error" in r) {
          anyFailed = true;
          groups.push({ workspace: w.name, workspace_gid: w.gid, error: r.error });
        } else {
          total += r.completed;
          anyFloor ||= Boolean(r.at_least);
          groups.push({ workspace: w.name, workspace_gid: w.gid, ...r });
        }
      }
      if (groups.every((g) => g.error !== undefined))
        return fail(String(groups[0]?.error ?? "Asana refused."));
      return ok({
        since,
        until,
        total_completed: total,
        ...(anyFloor
          ? { note: "Counting stopped early in at least one workspace, so the real number is higher." }
          : {}),
        ...(anyFailed ? { warning: "Some workspaces could not be counted; see their errors." } : {}),
        workspaces: groups,
      });
    }
    case "list_projects":
      return inWorkspaces(ctx, args.workspace, (w) =>
        get(ctx, "/projects", {
          workspace: w.gid,
          archived: "false",
          limit: String(limitOf(args.limit)),
          opt_fields: "name,permalink_url,owner.name,due_on",
        }),
      );
    case "get_task": {
      const gid = gidOf(args.task_gid);
      if (!gid) return fail("task_gid must be a task ID (digits only).");
      const task = await get(ctx, `/tasks/${gid}`, {
        opt_fields: `${TASK_FIELDS},notes,created_at,modified_at,workspace.gid`,
      });
      if ("error" in task || !ctx.allowedWorkspaces) return answer(task);
      // A task is reached by its id alone, so its workspace is checked: ids from outside the chosen ones are refused.
      const home = (task.data as { workspace?: { gid?: string } } | null)?.workspace?.gid;
      if (!home || !ctx.allowedWorkspaces.includes(home)) {
        return fail("That task is in a workspace the person did not choose for Orbs.");
      }
      return answer(task);
    }
    case "search_tasks": {
      const text = typeof args.text === "string" ? args.text.trim().slice(0, 300) : "";
      if (!text) return fail("text is required.");
      return inWorkspaces(ctx, args.workspace, (w) =>
        get(ctx, `/workspaces/${w.gid}/tasks/search`, {
          text,
          limit: String(limitOf(args.limit)),
          opt_fields: TASK_FIELDS,
        }),
      );
    }
    default:
      return fail(`Unknown tool: ${tool}`);
  }
}
