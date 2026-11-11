import { describe, expect, it } from "vitest";
import { ASANA_REST_TOOLS, AsanaUnauthorized, callAsanaRest, isAsanaRestTool } from "./asanaRest.ts";

interface Seen {
  url: URL;
  method: string;
  auth: string | null;
}

/** A fake Asana: answers each request from `reply(path)` and remembers what was asked. */
function fake(reply: (path: string, url: URL) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization") });
    const r = reply(url.pathname.replace("/api/1.0", ""), url);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, seen };
}

/** A fake Asana with two workspaces, each with its own task and project. */
const twoWorkspaces = (path: string, url: URL) => {
  if (path === "/users/me")
    return {
      body: {
        data: {
          workspaces: [
            { gid: "77", name: "Home" },
            { gid: "78", name: "Acme Corp" },
          ],
        },
      },
    };
  const ws = url.searchParams.get("workspace") ?? path.split("/")[2];
  const name = ws === "78" ? "Acme" : "Home";
  return { body: { data: [{ gid: ws === "78" ? "2" : "1", name: `${name} item` }] } };
};

const ctx = (f: typeof fetch) => ({ token: "PAT-SECRET", fetchImpl: f });

describe("Asana REST tools", () => {
  it("offers read-only tools, each with a description and an input schema", () => {
    expect(ASANA_REST_TOOLS.map((t) => t.name)).toEqual([
      "get_me",
      "get_my_tasks",
      "count_completed_tasks",
      "list_projects",
      "get_task",
      "search_tasks",
    ]);
    for (const t of ASANA_REST_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema.type).toBe("object");
    }
    expect(isAsanaRestTool("get_me")).toBe(true);
    expect(isAsanaRestTool("create_tasks")).toBe(false);
    expect(isAsanaRestTool("delete_task")).toBe(false);
  });

  it("only ever sends GET requests, with the token in a header and never in the address", async () => {
    const { f, seen } = fake((path) => ({
      body: { data: path === "/users/me" ? { workspaces: [{ gid: "11" }] } : [] },
    }));
    for (const [tool, args] of [
      ["get_me", {}],
      ["get_my_tasks", {}],
      ["list_projects", {}],
      ["get_task", { task_gid: "123" }],
      ["search_tasks", { text: "report" }],
    ] as const)
      await callAsanaRest(tool, args, ctx(f));
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const s of seen) {
      expect(s.method).toBe("GET");
      expect(s.auth).toBe("Bearer PAT-SECRET");
      expect(s.url.toString()).not.toContain("PAT-SECRET");
      expect(s.url.host).toBe("app.asana.com");
    }
  });

  it("looks in every workspace when none is named, and says which workspace each answer is from", async () => {
    const { f, seen } = fake(twoWorkspaces);
    const out = await callAsanaRest("get_my_tasks", { limit: 5 }, ctx(f));
    expect(out.isError).toBe(false);
    const groups = JSON.parse(out.content[0]?.text ?? "[]") as Array<{
      workspace: string;
      data: Array<{ name: string }>;
    }>;
    expect(groups.map((g) => [g.workspace, g.data[0]?.name])).toEqual([
      ["Home", "Home item"],
      ["Acme Corp", "Acme item"],
    ]);
    const asked = seen
      .filter((s) => s.url.pathname.endsWith("/tasks"))
      .map((s) => s.url.searchParams.get("workspace"));
    expect(asked).toEqual(["77", "78"]);
    expect(seen.find((s) => s.url.pathname.endsWith("/tasks"))?.url.searchParams.get("assignee")).toBe("me");
  });

  it("looks only in the workspace that is named, by name (any case, or part of it) or by ID", async () => {
    for (const asked of ["Acme Corp", "acme corp", "acme", "78"]) {
      const { f, seen } = fake(twoWorkspaces);
      const out = await callAsanaRest("list_projects", { workspace: asked }, ctx(f));
      expect(out.isError).toBe(false);
      const groups = JSON.parse(out.content[0]?.text ?? "[]") as Array<{ workspace: string }>;
      expect(groups.map((g) => g.workspace)).toEqual(["Acme Corp"]);
      expect(
        seen
          .filter((s) => s.url.pathname.endsWith("/projects"))
          .map((s) => s.url.searchParams.get("workspace")),
      ).toEqual(["78"]);
    }
  });

  it("says which workspaces exist when the name doesn't match any", async () => {
    const { f, seen } = fake(twoWorkspaces);
    const out = await callAsanaRest("get_my_tasks", { workspace: "Nowhere" }, ctx(f));
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("Home, Acme Corp");
    expect(seen.filter((s) => s.url.pathname.endsWith("/tasks"))).toHaveLength(0);
  });

  it("reports a problem in one workspace for that workspace only, and fails only when every one failed", async () => {
    const oneFails = fake((path, url) =>
      path === "/users/me" || url.searchParams.get("workspace") === "77"
        ? twoWorkspaces(path, url)
        : { status: 402, body: { errors: [{ message: "Needs a paid plan" }] } },
    );
    const mixed = JSON.parse(
      (await callAsanaRest("get_my_tasks", {}, ctx(oneFails.f))).content[0]?.text ?? "[]",
    ) as Array<{ workspace: string; error?: string; data?: unknown }>;
    expect(mixed[0]).toMatchObject({ workspace: "Home" });
    expect(mixed[1]).toMatchObject({ workspace: "Acme Corp", error: "Needs a paid plan" });

    const allFail = fake((path, url) =>
      path === "/users/me"
        ? twoWorkspaces(path, url)
        : { status: 402, body: { errors: [{ message: "Needs a paid plan" }] } },
    );
    const out = await callAsanaRest("get_my_tasks", {}, ctx(allFail.f));
    expect(out).toMatchObject({ isError: true });
    expect(out.content[0]?.text).toBe("Needs a paid plan");
  });

  it("caps how many are asked for and falls back to a sensible default", async () => {
    const { f, seen } = fake(twoWorkspaces);
    await callAsanaRest("list_projects", { workspace: "77", limit: 100000 }, ctx(f));
    await callAsanaRest("list_projects", { workspace: "77", limit: "abc" }, ctx(f));
    expect(
      seen.filter((s) => s.url.pathname.endsWith("/projects")).map((s) => s.url.searchParams.get("limit")),
    ).toEqual(["50", "20"]);
  });

  it("refuses ids that could change where the request goes", async () => {
    const { f, seen } = fake(twoWorkspaces);
    for (const bad of ["1/../../users/me", "12?x=1", "abc", "", "1 2"]) {
      const out = await callAsanaRest("get_task", { task_gid: bad }, ctx(f));
      expect(out.isError).toBe(true);
    }
    // What is typed as a workspace is only ever compared with the account's own list, never put in an address.
    for (const tool of ["list_projects", "get_my_tasks", "search_tasks"]) {
      const out = await callAsanaRest(tool, { text: "x", workspace: "../x/9/9?y" }, ctx(f));
      expect(out.isError).toBe(true);
    }
    expect(seen.every((s) => s.url.pathname === "/api/1.0/users/me")).toBe(true);
  });

  it("asks for a new token when Asana refuses it, but reports other problems as results", async () => {
    const unauthorized = fake(() => ({ status: 401, body: { errors: [{ message: "Not Authorized" }] } }));
    await expect(callAsanaRest("get_me", {}, ctx(unauthorized.f))).rejects.toBeInstanceOf(AsanaUnauthorized);

    const premium = fake(() => ({
      status: 402,
      body: { errors: [{ message: "Search needs a paid plan" }] },
    }));
    const out = await callAsanaRest("search_tasks", { text: "x", workspace: "5" }, ctx(premium.f));
    expect(out).toMatchObject({ isError: true });
    expect(out.content[0]?.text).toBe("Search needs a paid plan");

    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect((await callAsanaRest("get_me", {}, { token: "t", fetchImpl: down })).isError).toBe(true);
  });

  it("rejects a tool it doesn't know", async () => {
    const { f } = fake(() => ({ body: { data: {} } }));
    expect((await callAsanaRest("delete_task", { task_gid: "1" }, ctx(f))).isError).toBe(true);
  });

  describe("with only some workspaces allowed", () => {
    const run = async (tool: string, args: Record<string, unknown>, gids: string[]) => {
      const { f, seen } = fake((path, url) => {
        if (path.startsWith("/tasks/")) {
          const gid = path.split("/")[2];
          return { body: { data: { gid, name: "A task", workspace: { gid: gid === "9" ? "78" : "77" } } } };
        }
        return twoWorkspaces(path, url);
      });
      const out = await callAsanaRest(tool, args, { token: "T", fetchImpl: f, allowedWorkspaces: gids });
      return { out, seen };
    };

    it("looks only in the allowed ones when none is named", async () => {
      const { out, seen } = await run("get_my_tasks", {}, ["78"]);
      const groups = JSON.parse(out.content[0]?.text ?? "[]") as Array<{ workspace: string }>;
      expect(groups.map((g) => g.workspace)).toEqual(["Acme Corp"]);
      expect(
        seen.filter((s) => s.url.pathname.endsWith("/tasks")).map((s) => s.url.searchParams.get("workspace")),
      ).toEqual(["78"]);
    });

    it("can't be asked into one that wasn't allowed, by name or by ID", async () => {
      for (const asked of ["Home", "77", "home"]) {
        const { out, seen } = await run("list_projects", { workspace: asked }, ["78"]);
        expect(out.isError).toBe(true);
        // It names only what the account may use here, never the workspace that was left out.
        expect(out.content[0]?.text).toContain("This account has: Acme Corp.");
        expect(seen.filter((s) => s.url.pathname.endsWith("/projects"))).toHaveLength(0);
      }
    });

    it("shows only the allowed workspaces in get_me", async () => {
      const { f } = fake(() => ({
        body: {
          data: {
            name: "Ann",
            workspaces: [
              { gid: "77", name: "Home" },
              { gid: "78", name: "Acme Corp" },
            ],
          },
        },
      }));
      const out = await callAsanaRest("get_me", {}, { token: "T", fetchImpl: f, allowedWorkspaces: ["78"] });
      const data = JSON.parse(out.content[0]?.text ?? "{}") as {
        name: string;
        workspaces: Array<{ gid: string }>;
      };
      expect(data.name).toBe("Ann");
      expect(data.workspaces.map((w) => w.gid)).toEqual(["78"]);
    });

    it("refuses a task, found by its id, that lives in a workspace that wasn't allowed", async () => {
      const mine = await run("get_task", { task_gid: "5" }, ["77"]); // lives in 77
      expect(mine.out.isError).toBe(false);
      const theirs = await run("get_task", { task_gid: "9" }, ["77"]); // lives in 78
      expect(theirs.out.isError).toBe(true);
      expect(theirs.out.content[0]?.text).toContain("did not choose");
      expect(theirs.out.content[0]?.text).not.toContain("A task");
    });

    it("says so when none of the chosen workspaces exists any more", async () => {
      const { out } = await run("get_my_tasks", {}, ["999"]);
      expect(out.isError).toBe(true);
      expect(out.content[0]?.text).toContain("available any more");
    });

    it("leaves everything open when nothing was chosen", async () => {
      const { f } = fake(twoWorkspaces);
      const out = await callAsanaRest(
        "get_my_tasks",
        {},
        { token: "T", fetchImpl: f, allowedWorkspaces: null },
      );
      expect(JSON.parse(out.content[0]?.text ?? "[]")).toHaveLength(2);
    });
  });

  describe("finished tasks", () => {
    /** A workspace's tasks, served two to a page; the offset says where the next page starts. */
    const tasksByPage = (all: Array<Record<string, unknown>>) => (url: URL) => {
      const start = Number(url.searchParams.get("offset") ?? 0);
      const slice = all.slice(start, start + 2);
      return {
        body: {
          data: slice,
          ...(start + 2 < all.length ? { next_page: { offset: String(start + 2) } } : {}),
        },
      };
    };
    const serve = (tasks: Array<Record<string, unknown>>) =>
      fake((path, url) => (path === "/users/me" ? twoWorkspaces(path, url) : tasksByPage(tasks)(url)));
    const done = (gid: string, at: string) => ({ gid, completed: true, completed_at: at });
    const mix = [
      done("1", "2026-03-10T10:00:00Z"),
      done("2", "2025-12-30T10:00:00Z"),
      { gid: "3", completed: false },
      done("4", "2026-03-20T10:00:00Z"),
      done("5", "2026-07-01T10:00:00Z"),
    ];

    it("counts the finished tasks of a period over every page, per month and in total", async () => {
      const { f, seen } = serve(mix);
      const out = await callAsanaRest(
        "count_completed_tasks",
        { since: "2026-01-01", workspace: "Home" },
        ctx(f),
      );
      expect(out.isError).toBe(false);
      const data = JSON.parse(out.content[0]?.text ?? "{}");
      expect(data.total_completed).toBe(3); // not the one from 2025, not the unfinished one
      expect(data.workspaces[0]).toMatchObject({
        workspace: "Home",
        completed: 3,
        by_month: { "2026-03": 2, "2026-07": 1 },
      });
      const asked = seen.filter((s) => s.url.pathname.endsWith("/tasks"));
      expect(asked).toHaveLength(3); // three pages of two
      expect(asked[1]?.url.searchParams.get("offset")).toBe("2");
      expect(asked[0]?.url.searchParams.get("completed_since")).toBe("2026-01-01T00:00:00.000Z");
      expect(asked.every((s) => s.method === "GET")).toBe(true);
    });

    it("stops at the end date, and adds up across workspaces", async () => {
      const { f } = serve(mix);
      const until = JSON.parse(
        (
          await callAsanaRest(
            "count_completed_tasks",
            { since: "2026-01-01", until: "2026-04-01", workspace: "Home" },
            ctx(f),
          )
        ).content[0]?.text ?? "{}",
      );
      expect(until.total_completed).toBe(2);
      const all = JSON.parse(
        (await callAsanaRest("count_completed_tasks", { since: "2026-01-01" }, ctx(f))).content[0]?.text ??
          "{}",
      );
      expect(all.workspaces.map((w: { workspace: string }) => w.workspace)).toEqual(["Home", "Acme Corp"]);
      expect(all.total_completed).toBe(6); // 3 in each of the two workspaces
    });

    it("refuses dates that aren't dates, before asking Asana anything", async () => {
      for (const args of [
        {},
        { since: "last year" },
        { since: "2026-13-45" },
        { since: "2026-01-01", until: "soon" },
        { since: "2026-06-01", until: "2026-01-01" },
      ]) {
        const { f, seen } = serve(mix);
        const out = await callAsanaRest("count_completed_tasks", args, ctx(f));
        expect(out.isError, JSON.stringify(args)).toBe(true);
        expect(seen).toHaveLength(0);
      }
    });

    it("says the number is a floor when there were too many pages to read", async () => {
      const { f, seen } = fake((path, url) =>
        path === "/users/me"
          ? twoWorkspaces(path, url)
          : { body: { data: [done("1", "2026-03-10T10:00:00Z")], next_page: { offset: "more" } } },
      );
      const out = await callAsanaRest(
        "count_completed_tasks",
        { since: "2026-01-01", workspace: "Home" },
        ctx(f),
      );
      const data = JSON.parse(out.content[0]?.text ?? "{}");
      expect(data.note).toContain("higher");
      expect(data.workspaces[0].at_least).toBe(true);
      expect(seen.filter((s) => s.url.pathname.endsWith("/tasks"))).toHaveLength(30);
    });

    it("lets get_my_tasks include finished tasks, only the finished ones, or only unfinished (the default)", async () => {
      const page = (tasks: Array<Record<string, unknown>>) =>
        fake((path, url) => (path === "/users/me" ? twoWorkspaces(path, url) : { body: { data: tasks } }));
      const ask = async (args: Record<string, unknown>) => {
        const { f, seen } = page(mix);
        const out = await callAsanaRest("get_my_tasks", { workspace: "Home", ...args }, ctx(f));
        const groups = JSON.parse(out.content[0]?.text ?? "[]") as Array<{ data: Array<{ gid: string }> }>;
        return {
          ids: groups[0]?.data.map((t) => t.gid),
          since: seen.find((s) => s.url.pathname.endsWith("/tasks"))?.url.searchParams.get("completed_since"),
        };
      };
      expect((await ask({})).since).toBe("now");
      const completed = await ask({ status: "completed", since: "2026-01-01" });
      expect(completed.ids).toEqual(["1", "4", "5"]);
      expect(completed.since).toBe("2026-01-01T00:00:00.000Z");
      expect((await ask({ status: "all", since: "2026-01-01" })).ids).toEqual(["1", "2", "3", "4", "5"]);
      const { f } = page(mix);
      expect(
        (await callAsanaRest("get_my_tasks", { status: "all", since: "yesterday-ish" }, ctx(f))).isError,
      ).toBe(true);
    });
  });
});
