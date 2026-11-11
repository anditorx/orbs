/**
 * End-to-end test of the connector flow against a local mock of Asana and the real database.
 * Skipped unless DATABASE_URL and ORBS_SECRET_KEY are present, e.g.:
 *   node --env-file=../../.env ../../node_modules/vitest/vitest.mjs run service.integration
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MockAsana, startMockAsana } from "../dev/mockAsana.ts";

const enabled = Boolean(process.env.DATABASE_URL && process.env.ORBS_SECRET_KEY);

describe.skipIf(!enabled)("connectors (mock Asana)", () => {
  let mock: MockAsana;
  let svc: typeof import("./service.ts");
  let dbm: typeof import("../db.ts");
  let schema: typeof import("@orbs/db").schema;
  let vaultm: typeof import("./vault.ts");
  let orm: typeof import("drizzle-orm");

  const tag = randomBytes(4).toString("hex");
  const orgId = `test-org-${tag}`;
  const userA = `test-user-a-${tag}`;
  const userB = `test-user-b-${tag}`;
  const userC = `test-user-c-${tag}`;

  beforeAll(async () => {
    mock = await startMockAsana({
      clientId: "cid",
      clientSecret: "csecret",
      accessTtl: 3600,
      rotateRefresh: true,
    });
    process.env.ORBS_ASANA_MCP_URL = mock.mcpUrl;
    process.env.ORBS_ASANA_API_URL = `${mock.url}/api/1.0`;
    process.env.ORBS_ALLOW_PRIVATE_MCP_URLS = "true";
    process.env.ORBS_CONNECTOR_RATE_PER_MIN = "15";
    process.env.ORBS_WEB_URL = "https://orbs.test";
    svc = await import("./service.ts");
    dbm = await import("../db.ts");
    vaultm = await import("./vault.ts");
    orm = await import("drizzle-orm");
    ({ schema } = await import("@orbs/db"));
    const { db } = dbm;
    await db
      .insert(schema.organization)
      .values({ id: orgId, name: "T", slug: `t-${tag}`, createdAt: new Date() });
    for (const [id, n] of [
      [userA, "a"],
      [userB, "b"],
      [userC, "c"],
    ] as const)
      await db.insert(schema.user).values({ id, name: n, email: `${id}@test.invalid` });
    const { vault, aad } = vaultm;
    await db
      .insert(schema.connectorApp)
      .values({
        provider: "asana",
        clientId: "cid",
        clientSecretEnc: vault().encrypt("csecret", aad.clientSecret("asana")),
      })
      .onConflictDoUpdate({
        target: schema.connectorApp.provider,
        set: { clientId: "cid", clientSecretEnc: vault().encrypt("csecret", aad.clientSecret("asana")) },
      });
  });

  afterAll(async () => {
    if (!dbm) return;
    const { db } = dbm;
    const { eq } = orm;
    await db.delete(schema.auditLog).where(eq(schema.auditLog.orgId, orgId));
    await db.delete(schema.connection).where(eq(schema.connection.orgId, orgId));
    await db.delete(schema.oauthPending).where(eq(schema.oauthPending.orgId, orgId));
    await db.delete(schema.connectorApp).where(eq(schema.connectorApp.clientId, "cid"));
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
    for (const id of [userA, userB, userC]) await db.delete(schema.user).where(eq(schema.user.id, id));
    await mock?.close();
  });

  /** Plays the browser: opens the authorization URL and returns what the provider redirected back with. */
  async function authorize(userId: string) {
    const url = await svc.beginAuthorization(orgId, userId, "asana");
    const res = await fetch(url, { redirect: "manual" });
    const back = new URL(res.headers.get("location") ?? "");
    return {
      state: back.searchParams.get("state"),
      code: back.searchParams.get("code"),
      iss: back.searchParams.get("iss"),
      error: null,
    };
  }

  async function connect(userId = userA) {
    const params = await authorize(userId);
    await svc.completeAuthorization({ ...params, userId });
    const conn = await svc.getConnection(orgId, userId, "asana");
    if (!conn) throw new Error("no connection");
    return conn;
  }

  /** User A's connection; fails the test clearly if it is missing. */
  const mine = async () => {
    const conn = await svc.getConnection(orgId, userA, "asana");
    if (!conn) throw new Error("expected a connection for user A");
    return conn;
  };

  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };

  it("rejects a callback finished by a different user, and burns the state", async () => {
    const params = await authorize(userA);
    expect(await codeOf(svc.completeAuthorization({ ...params, userId: userB }))).toBe("wrong_user");
    expect(await codeOf(svc.completeAuthorization({ ...params, userId: userA }))).toBe("state_invalid");
  });

  it("rejects an unknown or replayed state", async () => {
    expect(
      await codeOf(
        svc.completeAuthorization({ state: "nope", code: "x", iss: null, error: null, userId: userA }),
      ),
    ).toBe("state_invalid");
    const params = await authorize(userA);
    await svc.completeAuthorization({ ...params, userId: userA });
    expect(await codeOf(svc.completeAuthorization({ ...params, userId: userA }))).toBe("state_invalid");
  });

  it("rejects a mismatched issuer", async () => {
    const params = await authorize(userA);
    expect(
      await codeOf(svc.completeAuthorization({ ...params, iss: "http://evil.example", userId: userA })),
    ).toBe("issuer_mismatch");
  });

  it("treats a denial as denied", async () => {
    const params = await authorize(userA);
    expect(
      await codeOf(
        svc.completeAuthorization({ ...params, code: null, error: "access_denied", userId: userA }),
      ),
    ).toBe("denied");
  });

  it("connects, learns the account and stores tokens encrypted", async () => {
    const conn = await connect();
    expect(conn.status).toBe("active");
    expect(conn.accountName).toBe("Mock Person");
    expect(conn.accountEmail).toBe("mock@example.com");
    expect(conn.workspaceName).toBe("Mock Workspace");
    expect(conn.accessTokenEnc.startsWith("v1.")).toBe(true);
    expect(conn.refreshTokenEnc?.startsWith("v1.")).toBe(true);
    // The pending row is gone once used.
    const pending = await dbm.db
      .select()
      .from(schema.oauthPending)
      .where(orm.eq(schema.oauthPending.orgId, orgId));
    expect(pending.length).toBe(0);
  });

  it("names the workspace even though the server's get_me only gives its id, and a test refreshes a missing one", async () => {
    const conn = await mine();
    expect(conn.workspaceName).toBe("Mock Workspace");
    await dbm.db
      .update(schema.connection)
      .set({ workspaceName: null })
      .where(orm.eq(schema.connection.id, conn.id));
    expect((await svc.testConnection(await mine())).workspaces).toEqual(["Mock Workspace"]);
    expect((await mine()).workspaceName).toBe("Mock Workspace");
  });

  it("lists tools with Orbs' own classification, allowing only reads", async () => {
    const conn = await mine();
    const tools = await svc.listTools(conn);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.get_me).toMatchObject({ kind: "read", allowed: true });
    expect(byName.get_my_tasks).toMatchObject({ kind: "read", allowed: true });
    expect(byName.create_tasks).toMatchObject({ kind: "write", allowed: false });
    expect(byName.delete_task).toMatchObject({ kind: "destructive", allowed: false });
    expect(byName.create_task_preview).toMatchObject({ kind: "interactive", allowed: false });
    expect(byName.brand_new_tool).toMatchObject({ kind: "unknown", allowed: false });
  });

  it("blocks non-read tools before they reach the provider", async () => {
    const conn = await mine();
    const before = mock.stats.toolCalls.length;
    for (const tool of ["create_tasks", "delete_task", "brand_new_tool", "create_task_preview"])
      expect(await codeOf(svc.callTool(conn, tool))).toBe("tool_blocked");
    expect(mock.stats.toolCalls.length).toBe(before);
    expect(await codeOf(svc.callTool(conn, "get_my_tasks"))).toBe("ok");
    expect(mock.stats.toolCalls.at(-1)).toBe("get_my_tasks");
  });

  it("recovers when the provider rejects an access token the clock still trusts", async () => {
    const conn = await mine();
    const before = mock.stats.refreshRequests;
    mock.expireAccessTokens();
    expect(await codeOf(svc.callTool(conn, "get_my_tasks"))).toBe("ok");
    expect(mock.stats.refreshRequests).toBe(before + 1);
  });

  it("refreshes exactly once when many calls race on an expired token (rotating refresh tokens)", async () => {
    const { db } = dbm;
    const conn = await mine();
    await db
      .update(schema.connection)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(schema.connection.id, conn.id));
    const before = mock.stats.refreshRequests;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => codeOf(svc.callTool(conn, "get_my_tasks"))),
    );
    expect(results.every((r) => r === "ok")).toBe(true);
    expect(mock.stats.refreshRequests).toBe(before + 1);
    const after = await mine();
    expect(after.status).toBe("active");
    expect(after.expiresAt?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });

  it("asks the user to reconnect when access was revoked at the provider", async () => {
    const conn = await mine();
    mock.revokeAll();
    mock.expireAccessTokens();
    expect(await codeOf(svc.callTool(conn, "get_my_tasks"))).toBe("needs_reauth");
    expect((await mine()).status).toBe("needs_reauth");
    // Fails fast afterwards, without contacting the provider.
    const before = mock.stats.tokenRequests;
    expect(await codeOf(svc.callTool(await mine(), "get_my_tasks"))).toBe("needs_reauth");
    expect(mock.stats.tokenRequests).toBe(before);
  });

  it("reconnecting restores a connection that needed reauth", async () => {
    const conn = await connect();
    expect(conn.status).toBe("active");
    expect(await codeOf(svc.callTool(conn, "get_my_tasks"))).toBe("ok");
  });

  it("disconnect revokes at the provider and forgets the connection", async () => {
    const conn = await mine();
    const before = mock.stats.revoked;
    expect(await svc.disconnect(conn)).toEqual({ revoked: true });
    expect(mock.stats.revoked).toBe(before + 1);
    expect(await svc.getConnection(orgId, userA, "asana")).toBeNull();
  });

  it("keeps connections per user", async () => {
    await connect(userA);
    expect(await svc.getConnection(orgId, userB, "asana")).toBeNull();
  });

  it("runs an allowed tool and returns its text, never a blocked one", async () => {
    const conn = await mine();
    const out = await svc.runTool(conn, "get_my_tasks", {});
    expect(out.isError).toBe(false);
    expect(out.truncated).toBe(false);
    expect(out.text).toContain("Write report");
    expect(await codeOf(svc.runTool(conn, "delete_task", { id: "1" }))).toBe("tool_blocked");
  });

  it("limits how often one connection can call the provider", async () => {
    // A fresh connection starts with an empty window.
    await svc.disconnect(await mine());
    const conn = await connect(userA);
    const before = mock.stats.toolCalls.length;
    const codes: string[] = [];
    for (let i = 0; i < 17; i++) codes.push(await codeOf(svc.callTool(conn, "get_my_tasks")));
    // The sign-in itself used get_me directly, so all 15 slots are free for these calls.
    expect(codes.filter((c) => c === "ok").length).toBe(15);
    expect(codes.slice(15)).toEqual(["rate_limited", "rate_limited"]);
    expect(mock.stats.toolCalls.length - before).toBe(15);
  });

  it("uses a person's own app instead of the shared one, and reconnecting is required after a change", async () => {
    await connect(userA);
    // Right client ID but a wrong secret: proves the personal app is the one being used.
    await svc.setOwnApp(userA, "asana", "cid", "wrong-secret");
    expect(await svc.getConnection(orgId, userA, "asana")).toBeNull();
    const params = await authorize(userA);
    expect(await codeOf(svc.completeAuthorization({ ...params, userId: userA }))).toBe("exchange_failed");
    // Someone else still uses the shared app.
    const other = await connect(userB);
    expect(other.status).toBe("active");
    // Removing the personal app falls back to the shared one.
    await svc.clearOwnApp(userA, "asana");
    expect((await connect(userA)).status).toBe("active");
    // The stored secret is encrypted.
    await svc.setOwnApp(userA, "asana", "cid", "csecret");
    const [row] = await dbm.db
      .select()
      .from(schema.userConnectorApp)
      .where(orm.eq(schema.userConnectorApp.userId, userA));
    expect(row?.clientSecretEnc.startsWith("v1.")).toBe(true);
    expect(row?.clientSecretEnc).not.toContain("csecret");
    expect((await connect(userA)).status).toBe("active");
    await svc.clearOwnApp(userA, "asana");
  });

  it("lets anyone connect with their own app, with no organization step", async () => {
    await svc.setOwnApp(userB, "asana", "cid", "csecret");
    expect((await connect(userB)).status).toBe("active");
    await svc.clearOwnApp(userB, "asana");
  });

  it("custom servers: nothing runs until the owner switches a tool on, and they are private to the owner", async () => {
    const custom = await import("./customMcp.ts");
    mock.allowToken("custom-token-123");
    const server = await custom.addServer(orgId, userA, {
      name: "mine",
      url: mock.mcpUrl,
      token: "custom-token-123",
    });
    expect(server.hasToken).toBe(true);
    expect(JSON.stringify(server)).not.toContain("custom-token-123");
    const [row] = await dbm.db
      .select()
      .from(schema.customMcpServer)
      .where(orm.eq(schema.customMcpServer.id, server.id));
    expect(row?.tokenEnc?.startsWith("v1.")).toBe(true);
    expect(row?.tokenEnc).not.toContain("custom-token-123");

    expect(await codeOf(custom.addServer(orgId, userA, { name: "mine", url: mock.mcpUrl }))).toBe(
      "name_taken",
    );

    const tools = await custom.listServerTools(orgId, userA, server.id);
    expect(tools.length).toBeGreaterThan(3);
    expect(tools.every((t) => !t.allowed)).toBe(true);
    expect(await codeOf(custom.runServerTool(orgId, userA, server.id, "get_my_tasks", {}))).toBe(
      "tool_blocked",
    );

    const allowed = await custom.setAllowedTools(orgId, userA, server.id, [
      "get_my_tasks",
      "not_a_real_tool",
    ]);
    expect(allowed).toEqual(["get_my_tasks"]);
    const out = await custom.runServerTool(orgId, userA, server.id, "get_my_tasks", {});
    expect(out.text).toContain("Write report");
    expect(await codeOf(custom.runServerTool(orgId, userA, server.id, "delete_task", {}))).toBe(
      "tool_blocked",
    );

    // Another person can neither see nor use it.
    expect(await custom.listServers(orgId, userB)).toEqual([]);
    expect(await codeOf(custom.runServerTool(orgId, userB, server.id, "get_my_tasks", {}))).toBe(
      "not_connected",
    );
    expect(await codeOf(custom.removeServer(orgId, userB, server.id))).toBe("not_connected");

    // A wrong token is reported as an upstream problem, not a crash.
    const bad = await custom.addServer(orgId, userA, { name: "badtoken", url: mock.mcpUrl, token: "nope" });
    expect(await codeOf(custom.listServerTools(orgId, userA, bad.id))).toBe("upstream");

    await custom.removeServer(orgId, userA, bad.id);
    await custom.removeServer(orgId, userA, server.id);
    expect(await custom.listServers(orgId, userA)).toEqual([]);

    const audits = await dbm.db.select().from(schema.auditLog).where(orm.eq(schema.auditLog.orgId, orgId));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["custom-mcp.add", "custom-mcp.call", "custom-mcp.remove"]),
    );
    expect(JSON.stringify(audits)).not.toContain("custom-token-123");
  });

  it("audits connect/disconnect/calls without ever storing tokens or tool output", async () => {
    const rows = await dbm.db.select().from(schema.auditLog).where(orm.eq(schema.auditLog.orgId, orgId));
    const actions = new Set(rows.map((r) => r.action));
    expect(actions).toContain("connection.connect");
    expect(actions).toContain("connection.disconnect");
    expect(actions).toContain("connection.call");
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/Write report|csecret|access_token|refresh_token/);
  });

  describe("connecting with a pasted token", () => {
    const PAT = `pat-${tag}-secret-value`;
    const codeOfToken = async (p: Promise<unknown>) => {
      try {
        await p;
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? "other";
      }
    };

    it("checks the token first, learns the account, and stores it encrypted with no expiry", async () => {
      mock.allowToken(PAT);
      const account = await svc.connectWithToken(orgId, userC, "asana", PAT);
      expect(account).toMatchObject({ name: "Mock Person", email: "mock@example.com" });
      const conn = await svc.getConnection(orgId, userC, "asana");
      expect(conn).toMatchObject({ status: "active", refreshTokenEnc: null, expiresAt: null, issuer: null });
      expect(conn?.accessTokenEnc).not.toContain(PAT);
      expect(
        vaultm.vault().decrypt(conn?.accessTokenEnc ?? "", vaultm.aad.accessToken(orgId, userC, "asana")),
      ).toBe(PAT);
    });

    it("uses the token as it is: no refresh, tools and tests work", async () => {
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (!conn) throw new Error("not connected");
      const before = mock.stats.refreshRequests + mock.stats.tokenRequests;
      expect((await svc.testConnection(conn)).name).toBe("Mock Person");
      expect((await svc.runTool(conn, "get_my_tasks", {})).text).toContain("Write report");
      expect(mock.stats.refreshRequests + mock.stats.tokenRequests).toBe(before);
    });

    it("goes through Asana's REST API, not the MCP server, and only ever reads", async () => {
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (!conn) throw new Error("not connected");
      expect(svc.isTokenConnection(conn)).toBe(true);
      const mcpBefore = mock.stats.toolCalls.length;
      const restBefore = mock.stats.restCalls.length;
      await svc.runTool(conn, "get_my_tasks", {});
      await svc.runTool(conn, "list_projects", {});
      expect((await svc.runTool(conn, "get_task", { task_gid: "11" })).text).toContain("Draft it");
      expect(mock.stats.toolCalls.length).toBe(mcpBefore); // nothing went to the MCP endpoint
      const calls = mock.stats.restCalls.slice(restBefore);
      expect(calls.length).toBeGreaterThanOrEqual(3);
      expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
    });

    it("counts the finished tasks of a period across every page and workspace", async () => {
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (!conn) throw new Error("not connected");
      const out = await svc.runTool(conn, "count_completed_tasks", { since: "2026-01-01" });
      expect(out.isError).toBe(false);
      const data = JSON.parse(out.text) as {
        total_completed: number;
        workspaces: Array<{ workspace: string; completed: number }>;
      };
      // One finished in 2026 in the first workspace (its second page held the unfinished one), two in the second.
      expect(data.workspaces.map((w) => [w.workspace, w.completed])).toEqual([
        ["Mock Workspace", 1],
        ["Second Org", 2],
      ]);
      expect(data.total_completed).toBe(3);
    });

    it("lists its own read-only tools for a token connection, and blocks anything else", async () => {
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (!conn) throw new Error("not connected");
      const tools = await svc.listTools(conn);
      expect(tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(["get_me", "get_my_tasks", "list_projects", "get_task"]),
      );
      expect(tools.every((t) => t.allowed && t.kind === "read")).toBe(true);
      expect(await codeOfToken(svc.runTool(conn, "create_tasks", {}))).toBe("tool_blocked");
      expect(await codeOfToken(svc.runTool(conn, "delete_task", { task_gid: "11" }))).toBe("tool_blocked");
    });

    it("returns Asana's own complaint as an error result instead of failing", async () => {
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (!conn) throw new Error("not connected");
      const out = await svc.runTool(conn, "search_tasks", { text: "report" });
      expect(out).toMatchObject({ isError: true, text: "Search needs a paid plan" });
      const bad = await svc.runTool(conn, "get_task", { task_gid: "11/../../users/me" });
      expect(bad.isError).toBe(true);
    });

    it("refuses a token the service doesn't accept, and saves nothing", async () => {
      expect(await codeOfToken(svc.connectWithToken(orgId, userB, "asana", "not-a-real-token"))).toBe(
        "token_rejected",
      );
      expect(await codeOfToken(svc.connectWithToken(orgId, userB, "asana", "   "))).toBe("token_rejected");
      expect(await svc.getConnection(orgId, userB, "asana")).toBeNull();
    });

    it("limits how fast tokens can be tried", async () => {
      const codes: string[] = [];
      for (let i = 0; i < 17; i++)
        codes.push(await codeOfToken(svc.connectWithToken(orgId, userB, "asana", `bad-${i}`)));
      expect(codes.slice(-1)[0]).toBe("rate_limited");
    });

    it("asks for a new token once the service stops accepting it, without trying to refresh", async () => {
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (!conn) throw new Error("not connected");
      mock.expireAccessTokens();
      const before = mock.stats.refreshRequests;
      expect(await codeOfToken(svc.callTool(conn, "get_my_tasks"))).toBe("needs_reauth");
      expect((await svc.getConnection(orgId, userC, "asana"))?.status).toBe("needs_reauth");
      expect(mock.stats.refreshRequests).toBe(before);
      // Asking again fails fast without contacting Asana.
      const restBefore = mock.stats.restCalls.length;
      expect(
        await codeOfToken(svc.callTool((await svc.getConnection(orgId, userC, "asana")) as never, "get_me")),
      ).toBe("needs_reauth");
      expect(mock.stats.restCalls.length).toBe(restBefore);
    });

    it("pasting a new token restores it, and disconnecting forgets it without contacting the service", async () => {
      mock.allowToken(`${PAT}-2`);
      await svc.connectWithToken(orgId, userC, "asana", `${PAT}-2`);
      expect((await svc.getConnection(orgId, userC, "asana"))?.status).toBe("active");
      const revoked = mock.stats.revoked;
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (!conn) throw new Error("not connected");
      expect(await svc.disconnect(conn)).toEqual({ revoked: false });
      expect(mock.stats.revoked).toBe(revoked);
      expect(await svc.getConnection(orgId, userC, "asana")).toBeNull();
    });

    it("never writes the token into the audit log", async () => {
      const rows = await dbm.db.select().from(schema.auditLog).where(orm.eq(schema.auditLog.orgId, orgId));
      expect(JSON.stringify(rows)).not.toContain(PAT);
      expect(rows.some((r) => (r.metadata as { method?: string } | null)?.method === "token")).toBe(true);
    });

    it("lets the person choose which of several workspaces the assistant may use", async () => {
      const token = `pat-ws-${tag}`;
      mock.allowToken(token);
      await svc.connectWithToken(orgId, userC, "asana", token);
      const conn = async () => {
        const c = await svc.getConnection(orgId, userC, "asana");
        if (!c) throw new Error("not connected");
        return c;
      };
      // Nothing chosen yet: both are on, and the account has more than one to choose from.
      const first = await svc.listWorkspaces(await conn());
      expect(first.choosable).toBe(true);
      expect(first.workspaces.map((w) => [w.name, w.enabled])).toEqual([
        ["Mock Workspace", true],
        ["Second Org", true],
      ]);
      const both = JSON.parse((await svc.runTool(await conn(), "get_my_tasks", {})).text) as Array<{
        workspace: string;
      }>;
      expect(both.map((g) => g.workspace)).toEqual(["Mock Workspace", "Second Org"]);

      // Choosing one narrows tools, get_me and what the connection says it is.
      expect(await svc.setWorkspaces(await conn(), ["501"])).toBe(1);
      const only = JSON.parse((await svc.runTool(await conn(), "get_my_tasks", {})).text) as Array<{
        workspace: string;
      }>;
      expect(only.map((g) => g.workspace)).toEqual(["Second Org"]);
      const me = JSON.parse((await svc.runTool(await conn(), "get_me", {})).text) as {
        workspaces: Array<{ gid: string }>;
      };
      expect(me.workspaces.map((w) => w.gid)).toEqual(["501"]);
      expect((await conn()).workspaceName).toBe("Second Org");
      expect((await svc.listWorkspaces(await conn())).workspaces.map((w) => [w.name, w.enabled])).toEqual([
        ["Mock Workspace", false],
        ["Second Org", true],
      ]);
      // A task in the other workspace is out of reach even by its id; one in the chosen workspace is fine.
      expect((await svc.runTool(await conn(), "get_task", { task_gid: "11" })).isError).toBe(true);
      expect((await svc.runTool(await conn(), "get_task", { task_gid: "12" })).isError).toBe(false);
    });

    it("needs at least one workspace, ignores ones the account doesn't have, and a new token starts over", async () => {
      const c = await svc.getConnection(orgId, userC, "asana");
      if (!c) throw new Error("not connected");
      expect(await codeOfToken(svc.setWorkspaces(c, []))).toBe("workspace_required");
      expect(await codeOfToken(svc.setWorkspaces(c, ["999"]))).toBe("workspace_required");
      expect(await svc.setWorkspaces(c, ["500", "999"])).toBe(1);
      const token = `pat-ws2-${tag}`;
      mock.allowToken(token);
      await svc.connectWithToken(orgId, userC, "asana", token);
      const again = await svc.getConnection(orgId, userC, "asana");
      expect(again?.allowedWorkspaces).toBeNull();
    });

    it("has nothing to choose for a sign-in connection", async () => {
      const c = await connect(userA);
      expect(svc.isTokenConnection(c)).toBe(false);
      expect(await svc.listWorkspaces(c)).toEqual({ choosable: false, workspaces: [] });
    });
  });

  describe("own app credentials", () => {
    const stored = () => svc.getOwnApp(userB, "asana");

    it("needs a secret the first time, and for a different client ID", async () => {
      expect(await codeOf(svc.setOwnApp(userB, "asana", "cid-x", undefined, {}))).toBe("secret_required");
      await svc.setOwnApp(userB, "asana", "cid-x", "secret-abcd", { appName: "One" });
      expect(await codeOf(svc.setOwnApp(userB, "asana", "cid-y", undefined, {}))).toBe("secret_required");
      expect((await stored())?.clientId).toBe("cid-x");
    });

    it("keeps the stored secret when none is typed, and shows only its last characters", async () => {
      await svc.setOwnApp(userB, "asana", "cid-x", undefined, { appName: "Renamed" });
      const row = await stored();
      expect(row?.appName).toBe("Renamed");
      expect(row && svc.ownSecretHint(row)).toBe("abcd");
      expect(row?.clientSecretEnc).not.toContain("secret-abcd");
    });

    it("keeps a sign-in connection when only the labels change, and drops it when the credentials do", async () => {
      await svc.setOwnApp(userB, "asana", "cid", "csecret", {});
      await connect(userB);
      await svc.setOwnApp(userB, "asana", "cid", undefined, { appName: "Just a label" });
      await svc.setOwnApp(userB, "asana", "cid", "csecret", { appName: "Same secret" });
      expect(await svc.getConnection(orgId, userB, "asana")).not.toBeNull();
      await svc.setOwnApp(userB, "asana", "cid", "another-secret", {});
      expect(await svc.getConnection(orgId, userB, "asana")).toBeNull();
      await svc.clearOwnApp(userB, "asana");
    });

    it("keeps a token connection when the app is saved or removed", async () => {
      const token = `pat-keep-${tag}`;
      mock.allowToken(token);
      await svc.connectWithToken(orgId, userC, "asana", token);
      await svc.setOwnApp(userC, "asana", "cid", "csecret", {});
      await svc.clearOwnApp(userC, "asana");
      expect(await svc.getConnection(orgId, userC, "asana")).not.toBeNull();
      const conn = await svc.getConnection(orgId, userC, "asana");
      if (conn) await svc.disconnect(conn);
    });
  });

  describe("finishing with a pasted code (no https address)", () => {
    const OOB = "urn:ietf:wg:oauth:2.0:oob";

    it("asks for no scope, registers the paste-a-code address, and connects from the code alone", async () => {
      const url = await svc.beginAuthorization(orgId, userC, "asana", OOB);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("redirect_uri")).toBe(OOB);
      expect(parsed.searchParams.has("scope")).toBe(false);
      const code = await (await fetch(url)).text();
      const state = parsed.searchParams.get("state");
      await svc.completeAuthorization({ state, code, iss: null, error: null, userId: userC });
      const conn = await svc.getConnection(orgId, userC, "asana");
      expect(conn).toMatchObject({ status: "active", accountName: "Mock Person" });
      expect(conn?.refreshTokenEnc).not.toBeNull();
      if (conn) await svc.disconnect(conn);
    });

    it("works only for the person who started it, and only once", async () => {
      const url = await svc.beginAuthorization(orgId, userC, "asana", OOB);
      const code = await (await fetch(url)).text();
      const state = new URL(url).searchParams.get("state");
      expect(
        await codeOf(svc.completeAuthorization({ state, code, iss: null, error: null, userId: userB })),
      ).toBe("wrong_user");
      expect(
        await codeOf(svc.completeAuthorization({ state, code, iss: null, error: null, userId: userC })),
      ).toBe("state_invalid");
    });

    it("still checks the issuer when the code came back through a redirect", async () => {
      const params = await authorize(userC);
      expect(await codeOf(svc.completeAuthorization({ ...params, iss: null, userId: userC }))).toBe(
        "issuer_mismatch",
      );
    });
  });
});
