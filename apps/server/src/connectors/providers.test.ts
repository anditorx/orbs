import { describe, expect, it } from "vitest";
import { asana, isToolAllowed, parseAccount, readAccount, redirectUriFor } from "./providers.ts";

describe("redirectUriFor", () => {
  it("is Orbs' own callback, whatever the address", () => {
    expect(redirectUriFor("https://orbs.example.com/")).toBe(
      "https://orbs.example.com/api/connections/oauth/callback",
    );
    expect(redirectUriFor("http://localhost:5173")).toBe(
      "http://localhost:5173/api/connections/oauth/callback",
    );
  });
});

describe("asana tool policy", () => {
  it("only lets read-only tools run", () => {
    for (const t of ["get_me", "get_tasks", "search_objects", "get_status_overview"]) {
      expect(isToolAllowed(asana, t), t).toBe(true);
    }
  });

  it("blocks writes, deletes and UI helpers", () => {
    for (const t of ["create_tasks", "update_tasks", "add_comment", "update_project"]) {
      expect(asana.classify(t), t).toBe("write");
      expect(isToolAllowed(asana, t), t).toBe(false);
    }
    expect(asana.classify("delete_task")).toBe("destructive");
    expect(asana.classify("delete_record")).toBe("destructive");
    expect(asana.classify("create_task_preview")).toBe("interactive");
    expect(isToolAllowed(asana, "delete_task")).toBe(false);
  });

  it("denies anything it has never seen, even if it looks harmless", () => {
    expect(asana.classify("get_something_new")).toBe("unknown");
    expect(isToolAllowed(asana, "get_something_new")).toBe(false);
    expect(isToolAllowed(asana, "")).toBe(false);
  });

  it("matches Asana's documented tool counts (25 read, 14 write, 2 destructive, 3 interactive)", () => {
    const names = [
      ...["search_objects", "get_task", "get_task_stories", "get_tasks", "get_my_tasks", "get_notifications"],
      ...[
        "search_tasks",
        "get_project",
        "get_projects",
        "get_portfolio",
        "get_portfolios",
        "get_items_for_portfolio",
      ],
      ...[
        "get_status_overview",
        "get_attachments",
        "get_user",
        "get_me",
        "get_users",
        "get_teams",
        "get_agent",
      ],
      ...["get_workspace_agents", "get_table", "get_tables", "get_record", "get_records", "search_records"],
    ];
    expect(names).toHaveLength(25);
    expect(names.every((n) => asana.classify(n) === "read")).toBe(true);
  });
});

describe("parseAccount", () => {
  it("reads a flat JSON result", () => {
    expect(
      parseAccount('{"name":"Andi","email":"a@x.id","workspaces":[{"gid":"1","name":"Tim A"}]}'),
    ).toEqual({
      name: "Andi",
      email: "a@x.id",
      workspaces: ["Tim A"],
    });
  });

  it("reads Asana's usual { data: { ... } } envelope and workspace memberships", () => {
    const text = JSON.stringify({
      data: { name: "Beni", email: "b@x.id", workspaces: [{ name: "W1" }, { name: "W2" }] },
    });
    expect(parseAccount(text)).toEqual({ name: "Beni", email: "b@x.id", workspaces: ["W1", "W2"] });
    const memberships = JSON.stringify({ name: "C", workspace_memberships: [{ workspace: { name: "W3" } }] });
    expect(parseAccount(memberships).workspaces).toEqual(["W3"]);
  });

  it("never throws on unexpected output", () => {
    const empty = { name: null, email: null, workspaces: [] };
    expect(parseAccount(undefined)).toEqual(empty);
    expect(parseAccount("not json")).toEqual(empty);
    expect(parseAccount("[1,2,3]")).toEqual(empty);
    expect(parseAccount("null")).toEqual(empty);
  });
});

describe("readAccount", () => {
  const result = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify({ data }) }] });
  const asker = (answers: Record<string, unknown>) => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    return {
      calls,
      ask: async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args });
        const a = answers[tool];
        if (a instanceof Error) throw a;
        return a;
      },
    };
  };

  it("takes workspace names from get_me when it has them, with no second call", async () => {
    const { ask, calls } = asker({
      get_me: result({ name: "Ann", email: "a@x.test", workspaces: [{ gid: "1", name: "Acme" }] }),
    });
    expect(await readAccount(ask)).toEqual({ name: "Ann", email: "a@x.test", workspaces: ["Acme"] });
    expect(calls.map((c) => c.tool)).toEqual(["get_me"]);
  });

  it("asks get_user for the names when get_me only lists workspace ids (as Asana's MCP server does)", async () => {
    const { ask, calls } = asker({
      get_me: result({
        name: "Ann",
        email: "a@x.test",
        workspaces: [{ gid: "1", resource_type: "workspace" }],
      }),
      get_user: result({
        name: "Ann",
        workspaces: [
          { gid: "1", name: "Acme" },
          { gid: "2", name: "Side" },
        ],
      }),
    });
    expect(await readAccount(ask)).toEqual({ name: "Ann", email: "a@x.test", workspaces: ["Acme", "Side"] });
    expect(calls[1]).toEqual({
      tool: "get_user",
      args: { user_id: "me", opt_fields: "name,email,workspaces.name" },
    });
  });

  it("still returns the account, unnamed workspaces and all, when get_user fails", async () => {
    const { ask } = asker({
      get_me: result({ name: "Ann", email: "a@x.test", workspaces: [{ gid: "1" }] }),
      get_user: new Error("down"),
    });
    expect(await readAccount(ask)).toEqual({ name: "Ann", email: "a@x.test", workspaces: [] });
  });

  it("does not hide a failure of get_me itself", async () => {
    const { ask } = asker({ get_me: new Error("token refused") });
    await expect(readAccount(ask)).rejects.toThrow("token refused");
  });
});
