import { schema } from "@orbs/db";
import { asc, eq } from "drizzle-orm";
import { db } from "./db.ts";

export interface OrgModel {
  provider: string;
  modelId: string;
  displayName: string;
  maxDataClass: "public" | "internal" | "confidential";
  /** Usable: enabled for the organization AND active system-wide. */
  available: boolean;
  /** Why it is unavailable, when it is. */
  off: "global" | "org" | null;
}

/**
 * Models that appear for an organization (an `org_model` row exists), with whether each is usable.
 * A model is usable only when the organization has it enabled and it is active system-wide.
 */
export async function modelsForOrg(orgId: string): Promise<OrgModel[]> {
  const rows = await db
    .select({
      provider: schema.aiModel.provider,
      modelId: schema.aiModel.modelId,
      displayName: schema.aiModel.displayName,
      maxDataClass: schema.aiModel.maxDataClass,
      active: schema.aiModel.active,
      enabled: schema.orgModel.enabled,
    })
    .from(schema.orgModel)
    .innerJoin(schema.aiModel, eq(schema.aiModel.id, schema.orgModel.modelRefId))
    .where(eq(schema.orgModel.orgId, orgId))
    .orderBy(asc(schema.aiModel.provider), asc(schema.aiModel.displayName));
  return rows.map((r) => ({
    provider: r.provider,
    modelId: r.modelId,
    displayName: r.displayName,
    maxDataClass: r.maxDataClass,
    available: r.active && r.enabled,
    off: !r.active ? "global" : !r.enabled ? "org" : null,
  }));
}

export async function isModelAvailable(orgId: string, provider: string, modelId: string) {
  const models = await modelsForOrg(orgId);
  return models.some((m) => m.provider === provider && m.modelId === modelId && m.available);
}
