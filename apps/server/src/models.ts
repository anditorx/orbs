import { schema } from "@orbs/db";
import { priceIsSet } from "@orbs/protocol";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./db.ts";

export interface OrgModel {
  provider: string;
  modelId: string;
  displayName: string;
  maxDataClass: "public" | "internal" | "confidential";
  /** Usable: provider connected and confirmed as paid, priced, enabled system-wide, and not switched off by the organization. */
  available: boolean;
  /** Why it is unavailable, when it is. */
  off: "provider" | "billing" | "unpriced" | "global" | "org" | null;
  inputUsdPerMtok: number | null;
  outputUsdPerMtok: number | null;
  qualityScore: number | null;
}

/**
 * Models in an organization's list: every listed model, unless the organization hides it. A model is usable only
 * when its provider is connected and confirmed as a paid plan, its price is filled in (otherwise its use would be
 * counted as free), it is enabled system-wide, and the organization hasn't switched it off.
 */
export async function modelsForOrg(orgId: string): Promise<OrgModel[]> {
  const rows = await db
    .select({
      provider: schema.aiModel.provider,
      modelId: schema.aiModel.modelId,
      displayName: schema.aiModel.displayName,
      maxDataClass: schema.aiModel.maxDataClass,
      active: schema.aiModel.active,
      input: schema.aiModel.inputUsdPerMtok,
      output: schema.aiModel.outputUsdPerMtok,
      quality: schema.aiModel.qualityScore,
      overrideEnabled: schema.orgModel.enabled,
      hidden: schema.orgModel.hidden,
      providerStatus: schema.modelProvider.status,
      billingConfirmed: schema.modelProvider.billingConfirmed,
    })
    .from(schema.aiModel)
    .leftJoin(
      schema.orgModel,
      and(eq(schema.orgModel.modelRefId, schema.aiModel.id), eq(schema.orgModel.orgId, orgId)),
    )
    .leftJoin(schema.modelProvider, eq(schema.modelProvider.provider, schema.aiModel.provider))
    .where(eq(schema.aiModel.listed, true))
    .orderBy(asc(schema.aiModel.provider), asc(schema.aiModel.displayName));
  return rows
    .filter((r) => !r.hidden)
    .map((r) => {
      const orgEnabled = r.overrideEnabled ?? true;
      // A provider that isn't connected (credentials removed or rejected) dims its models; it never deletes them.
      const connected = r.providerStatus === "connected";
      const billed = r.billingConfirmed === true;
      const input = r.input === null ? null : Number(r.input);
      const output = r.output === null ? null : Number(r.output);
      const priced = priceIsSet(r.provider, r.modelId, input, output);
      const off: OrgModel["off"] = !connected
        ? "provider"
        : !billed
          ? "billing"
          : !priced
            ? "unpriced"
            : !r.active
              ? "global"
              : !orgEnabled
                ? "org"
                : null;
      return {
        provider: r.provider,
        modelId: r.modelId,
        displayName: r.displayName,
        maxDataClass: r.maxDataClass,
        available: off === null,
        off,
        inputUsdPerMtok: input,
        outputUsdPerMtok: output,
        qualityScore: r.quality,
      };
    });
}

export async function isModelAvailable(orgId: string, provider: string, modelId: string) {
  const models = await modelsForOrg(orgId);
  return models.some((m) => m.provider === provider && m.modelId === modelId && m.available);
}

export interface ModelOrg {
  id: string;
  name: string;
  /** False when this organization switched the model off (it is still listed there, greyed out). */
  enabled: boolean;
}

/**
 * For each listed model, the organizations whose list it appears in, by name: every organization except those
 * that hide it. A model that isn't listed appears nowhere.
 */
export async function organizationsPerModel(): Promise<Map<string, ModelOrg[]>> {
  const [orgs, models, overrides] = await Promise.all([
    db
      .select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization)
      .orderBy(asc(schema.organization.name)),
    db.select({ id: schema.aiModel.id, listed: schema.aiModel.listed }).from(schema.aiModel),
    db
      .select({
        modelRefId: schema.orgModel.modelRefId,
        orgId: schema.orgModel.orgId,
        hidden: schema.orgModel.hidden,
        enabled: schema.orgModel.enabled,
      })
      .from(schema.orgModel),
  ]);
  const byKey = new Map(overrides.map((o) => [`${o.modelRefId}:${o.orgId}`, o]));
  return new Map(
    models.map((m) => [
      m.id,
      m.listed
        ? orgs
            .filter((o) => !byKey.get(`${m.id}:${o.id}`)?.hidden)
            .map((o) => ({ id: o.id, name: o.name, enabled: byKey.get(`${m.id}:${o.id}`)?.enabled ?? true }))
        : [],
    ]),
  );
}
