import { ORPCError } from "@orpc/server";
import { audit } from "../audit.ts";
import {
  addServer,
  listServers,
  listServerTools,
  removeServer,
  runServerTool,
  setAllowedTools,
} from "../connectors/customMcp.ts";
import { OOB_REDIRECT, PROVIDERS } from "../connectors/providers.ts";
import {
  beginAuthorization,
  type ConnectorError,
  ConnectorError as ConnectorErrorClass,
  clearOwnApp,
  completeAuthorization,
  connectWithToken,
  disconnect,
  getApp,
  getConnection,
  getOwnApp,
  listTools,
  listWorkspaces,
  ownSecretHint,
  redirectUri,
  runTool,
  setOwnApp,
  setWorkspaces,
  testConnection,
} from "../connectors/service.ts";
import { vaultReady } from "../connectors/vault.ts";
import { t } from "../i18n.ts";
import { inOrg } from "./base.ts";

/** Turns a connector failure into an error the user can read in their language (details stay in the server log). */
export function toOrpcError(error: unknown): never {
  if (error instanceof ConnectorErrorClass) {
    const code = (error as ConnectorError).code;
    if (code === "upstream" || code === "exchange_failed") console.error("[connector]", code, error.message);
    throw new ORPCError(
      code === "needs_reauth" || code === "not_connected"
        ? "PRECONDITION_FAILED"
        : code === "rate_limited"
          ? "TOO_MANY_REQUESTS"
          : "BAD_REQUEST",
      {
        message: t(`connector.${code}` as Parameters<typeof t>[0]),
      },
    );
  }
  throw error;
}

/** The connection, only while the organization still has the connector enabled. */
async function usableConnection(orgId: string, userId: string, provider: string) {
  if (!PROVIDERS[provider]) throw new ConnectorErrorClass("unknown_provider");
  const conn = await getConnection(orgId, userId, provider);
  if (!conn) throw new ConnectorErrorClass("not_connected");
  return conn;
}

export const connectionsRouter = {
  custom: {
    list: inOrg.connections.custom.list.handler(({ context }) => listServers(context.orgId, context.user.id)),
    add: inOrg.connections.custom.add.handler(async ({ context, input }) => {
      try {
        return await addServer(context.orgId, context.user.id, input);
      } catch (error) {
        return toOrpcError(error);
      }
    }),
    remove: inOrg.connections.custom.remove.handler(async ({ context, input }) => {
      try {
        await removeServer(context.orgId, context.user.id, input.id);
        return { ok: true as const };
      } catch (error) {
        return toOrpcError(error);
      }
    }),
    tools: inOrg.connections.custom.tools.handler(async ({ context, input }) => {
      try {
        return await listServerTools(context.orgId, context.user.id, input.id);
      } catch (error) {
        return toOrpcError(error);
      }
    }),
    setAllowed: inOrg.connections.custom.setAllowed.handler(async ({ context, input }) => {
      try {
        return { allowed: await setAllowedTools(context.orgId, context.user.id, input.id, input.tools) };
      } catch (error) {
        return toOrpcError(error);
      }
    }),
    call: inOrg.connections.custom.call.handler(async ({ context, input }) => {
      try {
        return await runServerTool(context.orgId, context.user.id, input.id, input.tool, input.args);
      } catch (error) {
        return toOrpcError(error);
      }
    }),
  },

  list: inOrg.connections.list.handler(async ({ context }) => {
    return Promise.all(
      Object.values(PROVIDERS).map(async (provider) => {
        const [app, own, conn] = await Promise.all([
          getApp(provider.id),
          getOwnApp(context.user.id, provider.id),
          getConnection(context.orgId, context.user.id, provider.id),
        ]);
        return {
          provider: provider.id,
          name: provider.name,
          vaultReady: vaultReady(),
          configured: Boolean(app || own),
          ownApp: own
            ? {
                clientId: own.clientId,
                appName: own.appName,
                description: own.description,
                secretHint: ownSecretHint(own),
              }
            : null,
          redirectUri: redirectUri(),
          connection: conn
            ? {
                status: conn.status,
                authMethod:
                  conn.refreshTokenEnc === null && conn.expiresAt === null
                    ? ("token" as const)
                    : ("oauth" as const),
                accountName: conn.accountName,
                accountEmail: conn.accountEmail,
                workspaceName: conn.workspaceName,
                connectedAt: conn.createdAt.toISOString(),
                lastUsedAt: conn.lastUsedAt?.toISOString() ?? null,
              }
            : null,
        };
      }),
    );
  }),

  start: inOrg.connections.start.handler(async ({ context, input }) => {
    try {
      if (input.mode !== "code") {
        return { url: await beginAuthorization(context.orgId, context.user.id, input.provider) };
      }
      const url = await beginAuthorization(context.orgId, context.user.id, input.provider, OOB_REDIRECT);
      return { url, state: new URL(url).searchParams.get("state") ?? undefined };
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  finish: inOrg.connections.finish.handler(async ({ context, input }) => {
    try {
      const done = await completeAuthorization({
        state: input.state,
        code: input.code,
        iss: input.iss ?? null,
        error: null,
        userId: context.user.id,
      });
      return { provider: done.provider };
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  connectWithToken: inOrg.connections.connectWithToken.handler(async ({ context, input }) => {
    try {
      if (!PROVIDERS[input.provider]) throw new ConnectorErrorClass("unknown_provider");
      return await connectWithToken(context.orgId, context.user.id, input.provider, input.token);
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  workspaces: inOrg.connections.workspaces.handler(async ({ context, input }) => {
    try {
      return await listWorkspaces(await usableConnection(context.orgId, context.user.id, input.provider));
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  setWorkspaces: inOrg.connections.setWorkspaces.handler(async ({ context, input }) => {
    try {
      const conn = await usableConnection(context.orgId, context.user.id, input.provider);
      return { chosen: await setWorkspaces(conn, input.gids) };
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  test: inOrg.connections.test.handler(async ({ context, input }) => {
    try {
      return await testConnection(await usableConnection(context.orgId, context.user.id, input.provider));
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  tools: inOrg.connections.tools.handler(async ({ context, input }) => {
    try {
      return await listTools(await usableConnection(context.orgId, context.user.id, input.provider));
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  call: inOrg.connections.call.handler(async ({ context, input }) => {
    try {
      const conn = await usableConnection(context.orgId, context.user.id, input.provider);
      return await runTool(conn, input.tool, input.args);
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  setOwnApp: inOrg.connections.setOwnApp.handler(async ({ context, input }) => {
    try {
      if (!PROVIDERS[input.provider]) throw new ConnectorErrorClass("unknown_provider");
      await setOwnApp(context.user.id, input.provider, input.clientId, input.clientSecret, {
        appName: input.appName,
        description: input.description,
      });
      await audit({
        orgId: context.orgId,
        actorId: context.user.id,
        action: "connection.app.set",
        targetType: "connector",
        targetId: input.provider,
        // Never the secret; the client ID is a public identifier.
        metadata: { clientId: input.clientId },
      });
      return { ok: true as const };
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  clearOwnApp: inOrg.connections.clearOwnApp.handler(async ({ context, input }) => {
    try {
      if (!PROVIDERS[input.provider]) throw new ConnectorErrorClass("unknown_provider");
      await clearOwnApp(context.user.id, input.provider);
      await audit({
        orgId: context.orgId,
        actorId: context.user.id,
        action: "connection.app.clear",
        targetType: "connector",
        targetId: input.provider,
      });
      return { ok: true as const };
    } catch (error) {
      return toOrpcError(error);
    }
  }),

  disconnect: inOrg.connections.disconnect.handler(async ({ context, input }) => {
    const conn = await getConnection(context.orgId, context.user.id, input.provider);
    if (!conn) return { revoked: false };
    return disconnect(conn);
  }),
};
