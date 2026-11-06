/**
 * Credentials for AI model providers, managed by system administrators. The key is encrypted at rest,
 * checked against the provider on save, and never sent back to the browser.
 */
import { schema } from "@orbs/db";
import type { ProviderDiagnostics } from "@orbs/protocol";
import { and, count, eq } from "drizzle-orm";
import { audit } from "./audit.ts";
import { aad, vault, vaultReady } from "./connectors/vault.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { checkGeminiEndpoints, type GeminiModel, listGeminiModels, usableChatModels } from "./geminiApi.ts";
import { type VerifyResult, verifyGemini } from "./geminiVerify.ts";

export type { VerifyResult };

export type Verifier = (apiKey: string) => Promise<VerifyResult>;

export interface ProviderDef {
  id: string;
  name: string;
  verify: Verifier;
}

export const MODEL_PROVIDERS: Record<string, ProviderDef> = {
  gemini: {
    id: "gemini",
    name: "Gemini",
    verify: (key) =>
      verifyGemini(
        key,
        fetch,
        env.ORBS_GEMINI_API_URL ? `${env.ORBS_GEMINI_API_URL}/models?pageSize=1` : undefined,
      ),
  },
};

export interface ProviderStatus {
  provider: string;
  providerName: string;
  vaultReady: boolean;
  configured: boolean;
  status: "connected" | "failed" | "not_configured";
  name: string | null;
  keyHint: string | null;
  projectName: string | null;
  projectNumber: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  modelCount: number;
  billingConfirmed: boolean;
}

export class ProviderError extends Error {
  constructor(
    readonly code:
      | "vault_missing"
      | "unknown_provider"
      | "key_required"
      | "not_configured"
      | "key_unreadable"
      | "provider_unreachable"
      | "activate_first"
      | "model_not_offered",
  ) {
    super(code);
  }
}

function def(id: string): ProviderDef {
  const found = MODEL_PROVIDERS[id];
  if (!found) throw new ProviderError("unknown_provider");
  return found;
}

export async function listProviders(): Promise<ProviderStatus[]> {
  const rows = await db.select().from(schema.modelProvider);
  const counts = await db
    .select({ provider: schema.aiModel.provider, n: count() })
    .from(schema.aiModel)
    .groupBy(schema.aiModel.provider);
  return Object.values(MODEL_PROVIDERS).map((p) => {
    const row = rows.find((r) => r.provider === p.id);
    return {
      provider: p.id,
      providerName: p.name,
      vaultReady: vaultReady(),
      configured: Boolean(row),
      status: row ? row.status : "not_configured",
      name: row?.name ?? null,
      keyHint: row?.keyHint ?? null,
      projectName: row?.projectName ?? null,
      projectNumber: row?.projectNumber ?? null,
      lastError: row?.lastError ?? null,
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      modelCount: counts.find((c) => c.provider === p.id)?.n ?? 0,
      billingConfirmed: row?.billingConfirmed ?? false,
    };
  });
}

/** Saves the credentials, then checks them. A blank key keeps the stored one. */
export async function saveProvider(
  actorId: string,
  input: {
    provider: string;
    name?: string;
    apiKey?: string;
    projectName?: string;
    projectNumber?: string;
    billingConfirmed?: boolean;
  },
  verify?: Verifier,
): Promise<ProviderStatus> {
  const provider = def(input.provider);
  if (!vaultReady()) throw new ProviderError("vault_missing");
  const [existing] = await db
    .select()
    .from(schema.modelProvider)
    .where(eq(schema.modelProvider.provider, provider.id))
    .limit(1);
  const newKey = input.apiKey?.trim();
  if (!newKey && !existing) throw new ProviderError("key_required");
  const apiKey = newKey ?? vault().decrypt(existing?.apiKeyEnc ?? "", aad.providerKey(provider.id));
  const result = await (verify ?? provider.verify)(apiKey);
  const values = {
    name: input.name?.trim() || existing?.name || provider.name,
    apiKeyEnc: newKey ? vault().encrypt(newKey, aad.providerKey(provider.id)) : (existing?.apiKeyEnc ?? ""),
    keyHint: newKey ? newKey.slice(-4) : (existing?.keyHint ?? ""),
    projectName: input.projectName?.trim() || null,
    projectNumber: input.projectNumber?.trim() || null,
    status: result.ok ? ("connected" as const) : ("failed" as const),
    lastError: result.ok ? null : result.error,
    lastCheckedAt: new Date(),
    failStreak: 0,
    // Only set when the person said something about it; a new key keeps the earlier statement.
    ...(input.billingConfirmed !== undefined && { billingConfirmed: input.billingConfirmed }),
  };
  await db
    .insert(schema.modelProvider)
    .values({ provider: provider.id, createdBy: actorId, ...values })
    .onConflictDoUpdate({ target: schema.modelProvider.provider, set: values });
  await audit({
    actorId,
    action: "system.provider.set",
    targetType: "provider",
    targetId: provider.id,
    // Never the key. The project identifiers are not secrets.
    metadata: { name: values.name, status: values.status, keyChanged: Boolean(newKey) },
  });
  return (await listProviders()).find((p) => p.provider === provider.id) as ProviderStatus;
}

/** A check newer than this is reused, so a busy page can't hammer the provider. */
const FRESH_MS = 10_000;

/**
 * Re-verifies every stored key against its provider and returns the truthful state. A key can be revoked,
 * expire or hit a quota after it was saved, so the stored badge alone can't be trusted. Periodic checks are
 * not audited (they would drown the log); explicit saves and tests are.
 */
export async function checkProviders(
  verify?: Verifier,
  now = Date.now(),
  only?: string[],
): Promise<ProviderStatus[]> {
  const rows = (await db.select().from(schema.modelProvider)).filter(
    (r) => !only || only.includes(r.provider),
  );
  await Promise.all(
    rows.map(async (row) => {
      if (row.lastCheckedAt && now - row.lastCheckedAt.getTime() < FRESH_MS) return;
      const provider = MODEL_PROVIDERS[row.provider];
      if (!provider) return;
      let result: VerifyResult;
      try {
        result = await (verify ?? provider.verify)(
          vault().decrypt(row.apiKeyEnc, aad.providerKey(provider.id)),
        );
      } catch {
        // For example the encryption key changed, so the stored key can't be read any more.
        result = { ok: false, error: "The stored key can't be read" };
      }
      // A passing problem (network, timeout, provider overload) must not dim every model at once: it takes three
      // checks in a row to count. A rejected key counts immediately.
      const GRACE = 2;
      if (!result.ok && result.transient && row.status === "connected" && row.failStreak < GRACE) {
        await db
          .update(schema.modelProvider)
          .set({ failStreak: row.failStreak + 1, lastCheckedAt: new Date(now) })
          .where(eq(schema.modelProvider.id, row.id));
        return;
      }
      await db
        .update(schema.modelProvider)
        .set({
          status: result.ok ? "connected" : "failed",
          lastError: result.ok ? null : result.error,
          lastCheckedAt: new Date(now),
          failStreak: result.ok ? 0 : row.failStreak + 1,
        })
        .where(eq(schema.modelProvider.id, row.id));
    }),
  );
  return listProviders();
}

/** Re-checks the stored key, for example after the provider's side changed. */
export async function testProvider(actorId: string, id: string, verify?: Verifier): Promise<ProviderStatus> {
  const provider = def(id);
  const [row] = await db
    .select()
    .from(schema.modelProvider)
    .where(eq(schema.modelProvider.provider, provider.id))
    .limit(1);
  if (!row) throw new ProviderError("not_configured");
  const result = await (verify ?? provider.verify)(
    vault().decrypt(row.apiKeyEnc, aad.providerKey(provider.id)),
  );
  await db
    .update(schema.modelProvider)
    .set({
      status: result.ok ? "connected" : "failed",
      lastError: result.ok ? null : result.error,
      lastCheckedAt: new Date(),
      failStreak: 0,
    })
    .where(eq(schema.modelProvider.id, row.id));
  await audit({
    actorId,
    action: "system.provider.test",
    targetType: "provider",
    targetId: provider.id,
    metadata: { status: result.ok ? "connected" : "failed" },
  });
  return (await listProviders()).find((p) => p.provider === provider.id) as ProviderStatus;
}

/** The models the stored key can see, read live from the provider. */
/** What each key could really use, remembered for a while: checking costs one tiny request per model. */
const USABLE_TTL_MS = 30 * 60_000;
const usableCache = new Map<string, { at: number; models: GeminiModel[] }>();

/**
 * The models an administrator can choose from: chat models the key really works with. Everything else the
 * provider lists (image, speech and embedding models, retired models it refuses for this project) is left out.
 * A model that is already registered always stays, marked `usable: false` when it stopped working, so it can
 * still be switched off.
 */
export async function listProviderModels(id: string): Promise<GeminiModel[]> {
  const provider = def(id);
  const [row] = await db
    .select()
    .from(schema.modelProvider)
    .where(eq(schema.modelProvider.provider, provider.id))
    .limit(1);
  if (!row) throw new ProviderError("not_configured");
  let key: string;
  try {
    key = vault().decrypt(row.apiKeyEnc, aad.providerKey(provider.id));
  } catch {
    throw new ProviderError("key_unreadable");
  }
  const cached = usableCache.get(row.apiKeyEnc);
  let checked = cached && Date.now() - cached.at < USABLE_TTL_MS ? cached.models : undefined;
  if (!checked) {
    const listed = await listGeminiModels(key, fetch, env.ORBS_GEMINI_API_URL);
    if (!listed.ok) throw new ProviderError("provider_unreachable");
    checked = await usableChatModels(key, listed.models, fetch, env.ORBS_GEMINI_API_URL);
    usableCache.set(row.apiKeyEnc, { at: Date.now(), models: checked });
  }
  const registered = new Set(
    (
      await db
        .select({ modelId: schema.aiModel.modelId })
        .from(schema.aiModel)
        .where(eq(schema.aiModel.provider, provider.id))
    ).map((m) => m.modelId),
  );
  return checked.filter((m) => m.usable !== false || registered.has(m.name.replace(/^models\//, "")));
}

/**
 * Sets one model from the provider's list. The first time a model is made active it is looked up in the
 * provider's own list, so only models the key really offers can be registered, under the provider's name for them.
 */
export async function setProviderModel(
  actorId: string,
  input: { provider: string; modelId: string; listed?: boolean; enabled?: boolean },
  list: (provider: string) => Promise<GeminiModel[]> = listProviderModels,
): Promise<void> {
  const provider = def(input.provider);
  const [existing] = await db
    .select()
    .from(schema.aiModel)
    .where(and(eq(schema.aiModel.provider, provider.id), eq(schema.aiModel.modelId, input.modelId)))
    .limit(1);
  if (existing) {
    await db
      .update(schema.aiModel)
      .set({
        ...(input.listed !== undefined && { listed: input.listed }),
        ...(input.enabled !== undefined && { active: input.enabled }),
        updatedAt: new Date(),
      })
      .where(eq(schema.aiModel.id, existing.id));
  } else {
    if (input.listed !== true) throw new ProviderError("activate_first");
    const offered = (await list(provider.id)).find(
      (m) => m.usable !== false && m.name.replace(/^models\//, "") === input.modelId,
    );
    if (!offered) throw new ProviderError("model_not_offered");
    await db.insert(schema.aiModel).values({
      provider: provider.id,
      modelId: input.modelId,
      displayName: offered.displayName,
      listed: true,
      active: input.enabled ?? true,
    });
  }
  await audit({
    actorId,
    action: "system.model.set",
    targetType: "model",
    targetId: `${provider.id}/${input.modelId}`,
    metadata: {
      provider: provider.id,
      modelId: input.modelId,
      ...(input.listed !== undefined && { listed: input.listed }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
  });
}

/** Everything the stored key can do: the models it sees and whether each endpoint family accepts it. */
export async function diagnoseProvider(actorId: string, id: string): Promise<ProviderDiagnostics> {
  const provider = def(id);
  const [row] = await db
    .select()
    .from(schema.modelProvider)
    .where(eq(schema.modelProvider.provider, provider.id))
    .limit(1);
  if (!row) throw new ProviderError("not_configured");
  let key: string;
  try {
    key = vault().decrypt(row.apiKeyEnc, aad.providerKey(provider.id));
  } catch {
    throw new ProviderError("key_unreadable");
  }
  const base = env.ORBS_GEMINI_API_URL;
  const listed = await listGeminiModels(key, fetch, base);
  const models = listed.ok ? listed.models : [];
  const endpoints = await checkGeminiEndpoints(key, models, fetch, base);
  const failed = endpoints.filter((e) => e.status === "failed").length;
  await audit({
    actorId,
    action: "system.provider.diagnose",
    targetType: "provider",
    targetId: provider.id,
    metadata: { models: models.length, ok: endpoints.filter((e) => e.status === "ok").length, failed },
  });
  return {
    checkedAt: new Date().toISOString(),
    modelsError: listed.ok ? null : listed.error,
    models,
    endpoints,
  };
}

/**
 * Removes a provider's credentials and, with them, every model registered under it (and those models' prices and
 * per-organization settings). Usage history is untouched: it is kept by provider and model name, with the price
 * frozen when it was recorded. A provider that is merely disconnected is different: its models stay, dimmed.
 */
/**
 * The administrator states that the provider account is on a paid, billing-enabled plan (or takes that back). Free
 * plans may use prompts to improve the provider's products, so models stay unavailable for chat until this is true.
 */
export async function setBilling(actorId: string, id: string, confirmed: boolean) {
  const provider = def(id);
  const updated = await db
    .update(schema.modelProvider)
    .set({ billingConfirmed: confirmed })
    .where(eq(schema.modelProvider.provider, provider.id))
    .returning({ id: schema.modelProvider.id });
  if (updated.length === 0) throw new ProviderError("not_configured");
  await audit({
    actorId,
    action: "system.provider.billing",
    targetType: "provider",
    targetId: provider.id,
    metadata: { confirmed },
  });
}

export async function removeProvider(actorId: string, id: string): Promise<{ modelsRemoved: number }> {
  const provider = def(id);
  const modelsRemoved = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.aiModel)
      .where(eq(schema.aiModel.provider, provider.id))
      .returning({ id: schema.aiModel.id });
    await tx.delete(schema.modelProvider).where(eq(schema.modelProvider.provider, provider.id));
    return removed.length;
  });
  await audit({
    actorId,
    action: "system.provider.remove",
    targetType: "provider",
    targetId: provider.id,
    metadata: { modelsRemoved },
  });
  return { modelsRemoved };
}
