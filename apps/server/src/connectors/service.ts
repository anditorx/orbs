import { randomBytes } from "node:crypto";
import {
  Client,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  StreamableHTTPClientTransport,
  startAuthorization,
  validateAuthorizationResponseIssuer,
} from "@modelcontextprotocol/client";
import { schema } from "@orbs/db";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import {
  ASANA_REST_TOOLS,
  AsanaUnauthorized,
  callAsanaRest,
  isAsanaRestTool,
  listAllWorkspaces,
} from "./asanaRest.ts";
import {
  type ConnectorProvider,
  isToolAllowed,
  OOB_REDIRECT,
  parseAccount,
  providerById,
  readAccount,
  redirectUriFor,
  type ToolKind,
} from "./providers.ts";
import { createRateLimiter } from "./rateLimit.ts";
import { aad, vault, vaultReady } from "./vault.ts";

/** Raised for problems the user can act on; `code` maps to a translated message in the UI. */
export class ConnectorError extends Error {
  constructor(
    readonly code:
      | "vault_missing"
      | "not_configured"
      | "unknown_provider"
      | "state_invalid"
      | "state_expired"
      | "wrong_user"
      | "denied"
      | "issuer_mismatch"
      | "exchange_failed"
      | "needs_reauth"
      | "secret_required"
      | "token_rejected"
      | "workspace_required"
      | "tool_blocked"
      | "rate_limited"
      | "unsafe_url"
      | "limit_reached"
      | "name_taken"
      | "not_connected"
      | "upstream",
    message?: string,
  ) {
    super(message ?? code);
  }
}

const limiter = createRateLimiter(env.ORBS_CONNECTOR_RATE_PER_MIN);
/** Tool output is cut here so one answer can't flood the response or a model's context. */
const MAX_RESULT_CHARS = 100_000;

const PENDING_TTL_MS = 10 * 60_000;
/** Refresh a little early so a token never expires mid-request. */
const REFRESH_MARGIN_MS = 60_000;

export function mcpUrl(provider: ConnectorProvider): string {
  return provider.id === "asana" && env.ORBS_ASANA_MCP_URL ? env.ORBS_ASANA_MCP_URL : provider.mcpUrl;
}

/** Asana's REST API address; unset means the real one. Only tests point it elsewhere. */
export function asanaApiBase(): string | undefined {
  return env.ORBS_ASANA_API_URL;
}

/** The address to register in the provider's console, exactly as it is: a callback URL, or the paste-a-code value. */
export function redirectUri(): string {
  return redirectUriFor(env.ORBS_WEB_URL);
}

function requireProvider(id: string): ConnectorProvider {
  const provider = providerById(id);
  if (!provider) throw new ConnectorError("unknown_provider");
  return provider;
}

// ---- Installation-level app credentials and per-organization enablement ----

export async function getApp(providerId: string) {
  const [row] = await db
    .select()
    .from(schema.connectorApp)
    .where(eq(schema.connectorApp.provider, providerId))
    .limit(1);
  return row ?? null;
}

export async function getOwnApp(userId: string, providerId: string) {
  const [row] = await db
    .select()
    .from(schema.userConnectorApp)
    .where(and(eq(schema.userConnectorApp.userId, userId), eq(schema.userConnectorApp.provider, providerId)))
    .limit(1);
  return row ?? null;
}

/** The person's own OAuth app if they registered one, otherwise the installation's. */
async function clientInfo(providerId: string, userId: string) {
  const own = await getOwnApp(userId, providerId);
  if (own) {
    return {
      client_id: own.clientId,
      client_secret: vault().decrypt(own.clientSecretEnc, aad.userClientSecret(userId, providerId)),
    };
  }
  const app = await getApp(providerId);
  if (!app) throw new ConnectorError("not_configured");
  return {
    client_id: app.clientId,
    client_secret: vault().decrypt(app.clientSecretEnc, aad.clientSecret(providerId)),
  };
}

/**
 * Saves (or replaces) a person's own app. The secret is optional once one is stored: leaving it out keeps it, so
 * renaming the app needs no retyping. Sign-in connections were made with the previous credentials, whose secret is
 * needed to refresh them, so they are dropped only when the client ID or the secret really changes.
 */
export async function setOwnApp(
  userId: string,
  providerId: string,
  clientId: string,
  clientSecret: string | undefined,
  labels: { appName?: string; description?: string } = {},
) {
  requireProvider(providerId);
  if (!vaultReady()) throw new ConnectorError("vault_missing");
  const existing = await getOwnApp(userId, providerId);
  const secretAad = aad.userClientSecret(userId, providerId);
  // A stored secret belongs to its client ID; a different app needs its own.
  const sameApp = existing?.clientId === clientId;
  if (!clientSecret && !sameApp) throw new ConnectorError("secret_required");
  const stored = existing && sameApp ? vault().decrypt(existing.clientSecretEnc, secretAad) : null;
  const changed = !sameApp || (clientSecret !== undefined && clientSecret !== stored);
  const values = {
    clientId,
    clientSecretEnc:
      clientSecret !== undefined
        ? vault().encrypt(clientSecret, secretAad)
        : (existing?.clientSecretEnc ?? ""),
    appName: labels.appName?.trim() || null,
    description: labels.description?.trim() || null,
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.userConnectorApp)
      .values({ userId, provider: providerId, ...values })
      .onConflictDoUpdate({
        target: [schema.userConnectorApp.userId, schema.userConnectorApp.provider],
        set: values,
      });
    if (changed) await dropUserConnections(tx, userId, providerId);
  });
}

/** The last characters of a person's stored secret, so they can tell it is there and which one it is. */
export function ownSecretHint(row: {
  userId: string;
  provider: string;
  clientSecretEnc: string;
}): string | null {
  try {
    return vault().decrypt(row.clientSecretEnc, aad.userClientSecret(row.userId, row.provider)).slice(-4);
  } catch {
    return null;
  }
}

export async function clearOwnApp(userId: string, providerId: string) {
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.userConnectorApp)
      .where(
        and(eq(schema.userConnectorApp.userId, userId), eq(schema.userConnectorApp.provider, providerId)),
      );
    await dropUserConnections(tx, userId, providerId);
  });
}

/** Forgets connections made through the app's sign-in. One made with a pasted token doesn't depend on any app. */
async function dropUserConnections(tx: Pick<typeof db, "delete">, userId: string, providerId: string) {
  await tx
    .delete(schema.connection)
    .where(
      and(
        eq(schema.connection.userId, userId),
        eq(schema.connection.provider, providerId),
        or(isNotNull(schema.connection.refreshTokenEnc), isNotNull(schema.connection.expiresAt)),
      ),
    );
  await tx
    .delete(schema.oauthPending)
    .where(and(eq(schema.oauthPending.userId, userId), eq(schema.oauthPending.provider, providerId)));
}

export async function getConnection(orgId: string, userId: string, providerId: string) {
  const [row] = await db
    .select()
    .from(schema.connection)
    .where(
      and(
        eq(schema.connection.orgId, orgId),
        eq(schema.connection.userId, userId),
        eq(schema.connection.provider, providerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---- Authorization (OAuth 2.1 authorization code + PKCE) ----

async function discover(provider: ConnectorProvider) {
  const info = await discoverOAuthServerInfo(mcpUrl(provider));
  if (!info.authorizationServerMetadata)
    throw new ConnectorError("upstream", "No authorization server metadata");
  return {
    authorizationServerUrl: info.authorizationServerUrl,
    metadata: info.authorizationServerMetadata,
    // Tokens are requested for exactly the resource the server advertises, falling back to its URL.
    resource: info.resourceMetadata?.resource ?? mcpUrl(provider),
  };
}

/** Starts an authorization and returns the provider URL the user's browser must open. */
export async function beginAuthorization(
  orgId: string,
  userId: string,
  providerId: string,
  redirect = redirectUri(),
): Promise<string> {
  const provider = requireProvider(providerId);
  if (!vaultReady()) throw new ConnectorError("vault_missing");
  const info = await clientInfo(providerId, userId);

  const found = await discover(provider);
  const state = randomBytes(32).toString("base64url");
  const { authorizationUrl, codeVerifier } = await startAuthorization(found.authorizationServerUrl, {
    metadata: found.metadata,
    clientInformation: info,
    redirectUrl: redirect,
    // No scope on purpose: Asana advertises "default", yet its docs say asking for one can fail with
    // "Invalid scope(s)", and MCP apps don't use scopes.
    state,
    resource: found.resource,
  });

  // Housekeeping: abandoned attempts expire on their own.
  await db.delete(schema.oauthPending).where(lt(schema.oauthPending.expiresAt, new Date()));
  await db.insert(schema.oauthPending).values({
    state,
    orgId,
    userId,
    provider: providerId,
    codeVerifierEnc: vault().encrypt(codeVerifier, aad.codeVerifier(state)),
    redirectUri: redirect,
    issuer: found.metadata.issuer,
    resource: found.resource,
    expiresAt: new Date(Date.now() + PENDING_TTL_MS),
  });
  return authorizationUrl.toString();
}

/**
 * Finishes an authorization from the provider's redirect. The `state` is consumed first, atomically,
 * so it works exactly once even if the callback is replayed or raced.
 */
export async function completeAuthorization(params: {
  state: string | null;
  code: string | null;
  iss: string | null;
  error: string | null;
  userId: string;
}): Promise<{ orgId: string; provider: string }> {
  if (!params.state) throw new ConnectorError("state_invalid");
  const [pending] = await db
    .delete(schema.oauthPending)
    .where(eq(schema.oauthPending.state, params.state))
    .returning();
  if (!pending) throw new ConnectorError("state_invalid");
  if (pending.expiresAt.getTime() < Date.now()) throw new ConnectorError("state_expired");
  // The browser that finishes must belong to the person who started: blocks login-CSRF / code injection.
  if (pending.userId !== params.userId) throw new ConnectorError("wrong_user");
  if (params.error || !params.code) throw new ConnectorError("denied");

  const provider = requireProvider(pending.provider);
  const info = await clientInfo(provider.id, pending.userId);
  const found = await discover(provider);
  // A pasted code never travelled through a redirect, so there is no `iss` to check and no mix-up to guard against:
  // it goes straight to the token endpoint of the server this attempt started with.
  const pasted = pending.redirectUri === OOB_REDIRECT;
  if (!pasted) {
    try {
      validateAuthorizationResponseIssuer({
        iss: params.iss ?? undefined,
        expectedIssuer: pending.issuer ?? undefined,
        issParameterSupported: Boolean(
          (found.metadata as { authorization_response_iss_parameter_supported?: boolean })
            .authorization_response_iss_parameter_supported,
        ),
      });
    } catch {
      throw new ConnectorError("issuer_mismatch");
    }
  }

  let tokens: Awaited<ReturnType<typeof exchangeAuthorization>>;
  try {
    tokens = await exchangeAuthorization(found.authorizationServerUrl, {
      metadata: found.metadata,
      clientInformation: info,
      authorizationCode: params.code,
      codeVerifier: vault().decrypt(pending.codeVerifierEnc, aad.codeVerifier(pending.state)),
      redirectUri: pending.redirectUri,
      resource: pending.resource ?? found.resource,
      // The library checks this too; a pasted code has none, so it vouches with the server this attempt began with.
      iss: params.iss ?? (pasted ? found.metadata.issuer : undefined),
    });
  } catch (error) {
    throw new ConnectorError("exchange_failed", error instanceof Error ? error.message : undefined);
  }

  // Prove the token works and learn whose account it is before saving anything.
  const account = await withMcp(provider, tokens.access_token, (client) =>
    readAccount((name, args) => client.callTool({ name, arguments: args })),
  ).catch((error) => {
    throw new ConnectorError("upstream", error instanceof Error ? error.message : undefined);
  });

  const values = {
    status: "active" as const,
    accountName: account.name,
    accountEmail: account.email,
    workspaceName: account.workspaces.join(", ").slice(0, 300) || null,
    accessTokenEnc: vault().encrypt(
      tokens.access_token,
      aad.accessToken(pending.orgId, pending.userId, provider.id),
    ),
    refreshTokenEnc: tokens.refresh_token
      ? vault().encrypt(tokens.refresh_token, aad.refreshToken(pending.orgId, pending.userId, provider.id))
      : null,
    expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    issuer: pending.issuer,
    resource: pending.resource,
    lastUsedAt: new Date(),
  };
  await db
    .insert(schema.connection)
    .values({ orgId: pending.orgId, userId: pending.userId, provider: provider.id, ...values })
    .onConflictDoUpdate({
      target: [schema.connection.orgId, schema.connection.userId, schema.connection.provider],
      set: values,
    });
  await audit({
    orgId: pending.orgId,
    actorId: pending.userId,
    action: "connection.connect",
    targetType: "connector",
    targetId: provider.id,
  });
  return { orgId: pending.orgId, provider: provider.id };
}

/**
 * Connects with a token the person pasted (for example Asana's personal access token) instead of the sign-in flow.
 * The token is tried against the service before anything is saved, so a wrong or expired one is refused with a
 * clear message and never stored. It is kept encrypted like any other credential, with no expiry and no refresh.
 */
export async function connectWithToken(
  orgId: string,
  userId: string,
  providerId: string,
  token: string,
): Promise<ReturnType<typeof parseAccount>> {
  const provider = requireProvider(providerId);
  if (!vaultReady()) throw new ConnectorError("vault_missing");
  const secret = token.trim();
  if (!secret) throw new ConnectorError("token_rejected");
  // Guessing tokens one after another is what this limit is for.
  if (!limiter.take(`token:${userId}`).ok) throw new ConnectorError("rate_limited");

  // A personal access token is for Asana's REST API; its MCP server only takes tokens issued by its own sign-in.
  let me: Awaited<ReturnType<typeof callAsanaRest>>;
  try {
    me = await callAsanaRest("get_me", {}, { token: secret, base: asanaApiBase() });
  } catch (error) {
    if (error instanceof AsanaUnauthorized) throw new ConnectorError("token_rejected");
    throw new ConnectorError("upstream", error instanceof Error ? error.message : undefined);
  }
  if (me.isError) throw new ConnectorError("upstream", me.content[0]?.text);
  const account = parseAccount(firstText(me));

  const values = {
    status: "active" as const,
    accountName: account.name,
    accountEmail: account.email,
    workspaceName: account.workspaces.join(", ").slice(0, 300) || null,
    accessTokenEnc: vault().encrypt(secret, aad.accessToken(orgId, userId, provider.id)),
    refreshTokenEnc: null,
    expiresAt: null,
    issuer: null,
    resource: null,
    // A new token may belong to another account, so an earlier choice of workspaces no longer applies.
    allowedWorkspaces: null,
    lastUsedAt: new Date(),
  };
  await db
    .insert(schema.connection)
    .values({ orgId, userId, provider: provider.id, ...values })
    .onConflictDoUpdate({
      target: [schema.connection.orgId, schema.connection.userId, schema.connection.provider],
      set: values,
    });
  await audit({
    orgId,
    actorId: userId,
    action: "connection.connect",
    targetType: "connector",
    targetId: provider.id,
    metadata: { method: "token" },
  });
  return account;
}

// ---- Using a connection ----

function firstText(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content;
  return content?.find((c) => c.type === "text")?.text;
}

async function withMcp<T>(
  provider: ConnectorProvider,
  accessToken: string,
  fn: (client: Client) => Promise<T>,
) {
  const client = new Client({ name: "orbs", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl(provider)), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Serializes work per connection across processes (a refresh token may be single-use). */
async function withLock<T>(connectionId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${connectionId}, 0))`);
    return fn();
  });
}

type ConnectionRow = typeof schema.connection.$inferSelect;

/**
 * Connected with a pasted token (no expiry, nothing to refresh) rather than the sign-in flow. For Asana such a
 * connection works through its REST API, with Orbs' own read-only tools, because the MCP server refuses these tokens.
 */
export function isTokenConnection(conn: ConnectionRow): boolean {
  return conn.provider === "asana" && conn.refreshTokenEnc === null && conn.expiresAt === null;
}

/** Runs one REST tool with the stored token. A token Asana refuses means: ask the person for a new one. */
async function callRest(conn: ConnectionRow, tool: string, args: Record<string, unknown>) {
  if (conn.status === "needs_reauth") throw new ConnectorError("needs_reauth");
  const token = vault().decrypt(conn.accessTokenEnc, aad.accessToken(conn.orgId, conn.userId, conn.provider));
  try {
    return await callAsanaRest(tool, args, {
      token,
      base: asanaApiBase(),
      allowedWorkspaces: conn.allowedWorkspaces?.map((w) => w.gid) ?? null,
    });
  } catch (error) {
    if (error instanceof AsanaUnauthorized) {
      await markNeedsReauth(conn.id);
      throw new ConnectorError("needs_reauth");
    }
    throw new ConnectorError("upstream", error instanceof Error ? error.message : undefined);
  } finally {
    await db
      .update(schema.connection)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.connection.id, conn.id));
  }
}

const PERMANENT_REFRESH_ERRORS = /invalid_grant|invalid_client|unauthorized_client|revoked|expired/i;

async function markNeedsReauth(id: string) {
  await db.update(schema.connection).set({ status: "needs_reauth" }).where(eq(schema.connection.id, id));
}

/** Exchanges the refresh token for new tokens. Re-reads inside the lock: someone else may have refreshed already. */
async function refreshConnection(connectionId: string, force: boolean): Promise<string> {
  return withLock(connectionId, async () => {
    const [conn] = await db
      .select()
      .from(schema.connection)
      .where(eq(schema.connection.id, connectionId))
      .limit(1);
    if (!conn) throw new ConnectorError("not_connected");
    const fresh = conn.expiresAt && conn.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
    if (fresh && !force)
      return vault().decrypt(conn.accessTokenEnc, aad.accessToken(conn.orgId, conn.userId, conn.provider));
    if (!conn.refreshTokenEnc) {
      await markNeedsReauth(conn.id);
      throw new ConnectorError("needs_reauth");
    }
    const provider = requireProvider(conn.provider);
    const refreshToken = vault().decrypt(
      conn.refreshTokenEnc,
      aad.refreshToken(conn.orgId, conn.userId, conn.provider),
    );
    const found = await discover(provider);
    try {
      const tokens = await refreshAuthorization(found.authorizationServerUrl, {
        metadata: found.metadata,
        clientInformation: await clientInfo(provider.id, conn.userId),
        refreshToken,
        resource: conn.resource ?? found.resource,
      });
      await db
        .update(schema.connection)
        .set({
          status: "active",
          accessTokenEnc: vault().encrypt(
            tokens.access_token,
            aad.accessToken(conn.orgId, conn.userId, conn.provider),
          ),
          refreshTokenEnc: vault().encrypt(
            tokens.refresh_token ?? refreshToken,
            aad.refreshToken(conn.orgId, conn.userId, conn.provider),
          ),
          expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
        })
        .where(eq(schema.connection.id, conn.id));
      return tokens.access_token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only a refusal from the provider means the user must reconnect; a network blip must not.
      if (
        PERMANENT_REFRESH_ERRORS.test(message) ||
        PERMANENT_REFRESH_ERRORS.test((error as { code?: string })?.code ?? "")
      ) {
        await markNeedsReauth(conn.id);
        throw new ConnectorError("needs_reauth");
      }
      throw new ConnectorError("upstream", message);
    }
  });
}

function looksUnauthorized(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // The SDK reports an HTTP rejection as SdkHttpError with the status on the error itself.
  return (
    (error as { status?: number })?.status === 401 ||
    /401|unauthori[sz]ed|invalid_token/i.test(message) ||
    (error as { name?: string })?.name === "UnauthorizedError"
  );
}

/** Runs `fn` against the provider with a valid token, refreshing once if the provider says it expired. */
async function withConnection<T>(conn: ConnectionRow, fn: (client: Client) => Promise<T>): Promise<T> {
  if (conn.status === "needs_reauth") throw new ConnectorError("needs_reauth");
  const provider = requireProvider(conn.provider);
  let token = await refreshConnection(conn.id, false);
  try {
    return await withMcp(provider, token, fn);
  } catch (error) {
    if (!looksUnauthorized(error))
      throw new ConnectorError("upstream", error instanceof Error ? error.message : undefined);
    token = await refreshConnection(conn.id, true);
    try {
      return await withMcp(provider, token, fn);
    } catch (second) {
      if (looksUnauthorized(second)) {
        await markNeedsReauth(conn.id);
        throw new ConnectorError("needs_reauth");
      }
      throw new ConnectorError("upstream", second instanceof Error ? second.message : undefined);
    }
  } finally {
    await db
      .update(schema.connection)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.connection.id, conn.id));
  }
}

export interface ToolInfo {
  name: string;
  description: string;
  kind: ToolKind;
  allowed: boolean;
  inputSchema: Record<string, unknown> | null;
}

/** Tools the provider exposes right now, each classified by Orbs' own policy. */
export async function listTools(conn: ConnectionRow): Promise<ToolInfo[]> {
  if (isTokenConnection(conn)) {
    return ASANA_REST_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      kind: "read" as const,
      allowed: true,
      inputSchema: tool.inputSchema,
    }));
  }
  const provider = requireProvider(conn.provider);
  const result = await withConnection(conn, (client) => client.listTools());
  return result.tools
    .map((tool) => {
      const kind = provider.classify(tool.name);
      return {
        name: tool.name,
        description: tool.description ?? "",
        kind,
        allowed: isToolAllowed(provider, tool.name),
        inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? null,
      };
    })
    .sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.name.localeCompare(b.name));
}

/** Calls one tool, only if Orbs' policy allows it. Every call is audited (tool name only, never content). */
export async function callTool(conn: ConnectionRow, tool: string, args: Record<string, unknown> = {}) {
  const provider = requireProvider(conn.provider);
  const viaRest = isTokenConnection(conn);
  if (viaRest ? !isAsanaRestTool(tool) : !isToolAllowed(provider, tool))
    throw new ConnectorError("tool_blocked", tool);
  if (!limiter.take(conn.id).ok) throw new ConnectorError("rate_limited");
  const started = Date.now();
  try {
    const result = viaRest
      ? await callRest(conn, tool, args)
      : await withConnection(conn, (client) => client.callTool({ name: tool, arguments: args }));
    await audit({
      orgId: conn.orgId,
      actorId: conn.userId,
      action: "connection.call",
      targetType: "connector",
      targetId: provider.id,
      metadata: { tool, ms: Date.now() - started, ok: true },
    });
    return result;
  } catch (error) {
    await audit({
      orgId: conn.orgId,
      actorId: conn.userId,
      action: "connection.call",
      targetType: "connector",
      targetId: provider.id,
      metadata: { tool, ms: Date.now() - started, ok: false },
    });
    throw error;
  }
}

/** Re-reads the account behind a connection (also proves the connection still works). */
export async function testConnection(conn: ConnectionRow) {
  const account = await readAccount((tool, args) => callTool(conn, tool, args));
  await db
    .update(schema.connection)
    .set({
      accountName: account.name ?? conn.accountName,
      accountEmail: account.email ?? conn.accountEmail,
      workspaceName: account.workspaces.join(", ").slice(0, 300) || conn.workspaceName,
    })
    .where(eq(schema.connection.id, conn.id));
  return account;
}

export interface WorkspaceChoice {
  gid: string;
  name: string;
  enabled: boolean;
}

/**
 * The workspaces behind a connection and which of them the assistant may use. Only a token connection can span several:
 * a sign-in (MCP) connection belongs to the single workspace chosen when it was authorized, so there is nothing to choose.
 */
export async function listWorkspaces(
  conn: ConnectionRow,
): Promise<{ choosable: boolean; workspaces: WorkspaceChoice[] }> {
  if (!isTokenConnection(conn)) return { choosable: false, workspaces: [] };
  const token = vault().decrypt(conn.accessTokenEnc, aad.accessToken(conn.orgId, conn.userId, conn.provider));
  let all: Awaited<ReturnType<typeof listAllWorkspaces>>;
  try {
    all = await listAllWorkspaces({ token, base: asanaApiBase() });
  } catch (error) {
    if (error instanceof AsanaUnauthorized) {
      await markNeedsReauth(conn.id);
      throw new ConnectorError("needs_reauth");
    }
    throw new ConnectorError("upstream", error instanceof Error ? error.message : undefined);
  }
  if ("error" in all) throw new ConnectorError("upstream", all.error);
  const chosen = conn.allowedWorkspaces ? new Set(conn.allowedWorkspaces.map((w) => w.gid)) : null;
  return {
    choosable: all.length > 1,
    workspaces: all.map((w) => ({ ...w, enabled: chosen ? chosen.has(w.gid) : true })),
  };
}

/** Saves which workspaces the assistant may use. At least one is needed; ids Asana doesn't list for the account are ignored. */
export async function setWorkspaces(conn: ConnectionRow, gids: string[]) {
  const { workspaces } = await listWorkspaces(conn);
  const wanted = new Set(gids);
  const chosen = workspaces.filter((w) => wanted.has(w.gid));
  if (chosen.length === 0) throw new ConnectorError("workspace_required");
  await db
    .update(schema.connection)
    .set({
      allowedWorkspaces: chosen.map((w) => ({ gid: w.gid, name: w.name })),
      workspaceName: chosen
        .map((w) => w.name)
        .join(", ")
        .slice(0, 300),
    })
    .where(eq(schema.connection.id, conn.id));
  await audit({
    orgId: conn.orgId,
    actorId: conn.userId,
    action: "connection.workspaces",
    targetType: "connector",
    targetId: conn.provider,
    metadata: { chosen: chosen.length, of: workspaces.length },
  });
  return chosen.length;
}

/** Revokes the grant at the provider (best effort), then forgets it. The local record always goes. */
export async function disconnect(conn: ConnectionRow): Promise<{ revoked: boolean }> {
  let revoked = false;
  try {
    if (conn.refreshTokenEnc && vaultReady()) {
      const provider = requireProvider(conn.provider);
      const found = await discover(provider);
      const endpoint = (found.metadata as { revocation_endpoint?: string }).revocation_endpoint;
      if (endpoint) {
        const info = await clientInfo(provider.id, conn.userId);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: vault().decrypt(
              conn.refreshTokenEnc,
              aad.refreshToken(conn.orgId, conn.userId, conn.provider),
            ),
            client_id: info.client_id,
            client_secret: info.client_secret,
          }),
        });
        revoked = response.ok;
      }
    }
  } catch {
    // The provider being unreachable must not trap the user in a connection they want gone.
  }
  limiter.forget(conn.id);
  await db.delete(schema.connection).where(eq(schema.connection.id, conn.id));
  await audit({
    orgId: conn.orgId,
    actorId: conn.userId,
    action: "connection.disconnect",
    targetType: "connector",
    targetId: conn.provider,
    metadata: { revoked },
  });
  return { revoked };
}

/** Runs an allowed tool and returns its text output, cut to a safe size. */
export async function runTool(conn: ConnectionRow, tool: string, args: Record<string, unknown>) {
  const result = await callTool(conn, tool, args);
  const raw = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const text = raw
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  const truncated = text.length > MAX_RESULT_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_RESULT_CHARS) : text,
    truncated,
    isError: Boolean((result as { isError?: boolean }).isError),
  };
}
