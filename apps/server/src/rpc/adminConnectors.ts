import { schema } from "@orbs/db";
import type { AdminConnector } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, count, eq, notInArray } from "drizzle-orm";
import { audit } from "../audit.ts";
import { PROVIDERS } from "../connectors/providers.ts";
import { redirectUri } from "../connectors/service.ts";
import { aad, vault, vaultReady } from "../connectors/vault.ts";
import { db } from "../db.ts";
import { t } from "../i18n.ts";
import { systemAdmin } from "./base.ts";

function requireProvider(id: string) {
  const provider = PROVIDERS[id];
  if (!provider) throw new ORPCError("NOT_FOUND", { message: t("connector.unknown_provider") });
  return provider;
}

export const adminConnectorsRouter = {
  list: systemAdmin.admin.connectors.list.handler(async (): Promise<AdminConnector[]> => {
    return Promise.all(
      Object.values(PROVIDERS).map(async (provider) => {
        const [[app], [people]] = await Promise.all([
          db.select().from(schema.connectorApp).where(eq(schema.connectorApp.provider, provider.id)).limit(1),
          db
            .select({ n: count() })
            .from(schema.connection)
            .where(eq(schema.connection.provider, provider.id)),
        ]);
        return {
          provider: provider.id,
          name: provider.name,
          vaultReady: vaultReady(),
          configured: Boolean(app),
          clientId: app?.clientId ?? null,
          redirectUri: redirectUri(),
          connectionCount: people?.n ?? 0,
        };
      }),
    );
  }),

  setApp: systemAdmin.admin.connectors.setApp.handler(async ({ context, input }) => {
    const provider = requireProvider(input.provider);
    if (!vaultReady()) throw new ORPCError("BAD_REQUEST", { message: t("connector.vault_missing") });
    const values = {
      clientId: input.clientId,
      clientSecretEnc: vault().encrypt(input.clientSecret, aad.clientSecret(provider.id)),
      createdBy: context.user.id,
    };
    await db
      .insert(schema.connectorApp)
      .values({ provider: provider.id, ...values })
      .onConflictDoUpdate({ target: schema.connectorApp.provider, set: values });
    await audit({
      actorId: context.user.id,
      action: "system.connector.set-app",
      targetType: "connector",
      targetId: provider.id,
      // Never the secret; the client ID is a public identifier.
      metadata: { clientId: input.clientId },
    });
    return { ok: true as const };
  }),

  clearApp: systemAdmin.admin.connectors.clearApp.handler(async ({ context, input }) => {
    const provider = requireProvider(input.provider);
    await db.transaction(async (tx) => {
      // Without the shared app's secret nobody using it can refresh or revoke, so those connections go
      // with it. People who registered their own app keep theirs.
      const ownApps = tx
        .select({ userId: schema.userConnectorApp.userId })
        .from(schema.userConnectorApp)
        .where(eq(schema.userConnectorApp.provider, provider.id));
      await tx
        .delete(schema.connection)
        .where(
          and(eq(schema.connection.provider, provider.id), notInArray(schema.connection.userId, ownApps)),
        );
      await tx
        .delete(schema.oauthPending)
        .where(
          and(eq(schema.oauthPending.provider, provider.id), notInArray(schema.oauthPending.userId, ownApps)),
        );
      await tx.delete(schema.connectorApp).where(eq(schema.connectorApp.provider, provider.id));
    });
    await audit({
      actorId: context.user.id,
      action: "system.connector.clear-app",
      targetType: "connector",
      targetId: provider.id,
    });
    return { ok: true as const };
  }),
};
