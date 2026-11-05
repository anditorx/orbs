import { schema } from "@orbs/db";
import type { AdminModel, OrgModelRow } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import { t } from "../i18n.ts";
import { systemAdmin } from "./base.ts";

/**
 * Model management for Orbs system administrators: a system-wide registry of models, plus per-organization
 * control over which of them appear and which are usable ("enabled") there.
 */

const M = schema.aiModel;
const toNumber = (v: string | null) => (v === null ? null : Number(v));
const toDecimal = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

async function requireOrg(orgId: string) {
  const [org] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  if (!org) throw new ORPCError("NOT_FOUND", { message: t("common.orgNotFound") });
  return org;
}

async function requireModel(modelId: string) {
  const [row] = await db.select().from(M).where(eq(M.id, modelId)).limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: t("model.notFound") });
  return row;
}

/** A unique-index violation on (provider, model id) means the model is already registered. */
function isDuplicate(error: unknown) {
  const code = (error as { code?: string; cause?: { code?: string } } | null) ?? {};
  return code.code === "23505" || code.cause?.code === "23505";
}

export const adminModelsRouter = {
  list: systemAdmin.admin.models.list.handler(async (): Promise<AdminModel[]> => {
    const rows = await db
      .select({
        id: M.id,
        provider: M.provider,
        modelId: M.modelId,
        displayName: M.displayName,
        input: M.inputUsdPerMtok,
        output: M.outputUsdPerMtok,
        qualityScore: M.qualityScore,
        maxDataClass: M.maxDataClass,
        active: M.active,
        orgCount: sql<number>`(select count(*)::int from "org_model" om where om.model_ref_id = "ai_model"."id")`,
      })
      .from(M)
      .orderBy(asc(M.provider), asc(M.displayName));
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      modelId: r.modelId,
      displayName: r.displayName,
      inputUsdPerMtok: toNumber(r.input),
      outputUsdPerMtok: toNumber(r.output),
      qualityScore: r.qualityScore,
      maxDataClass: r.maxDataClass,
      active: r.active,
      orgCount: r.orgCount,
    }));
  }),

  create: systemAdmin.admin.models.create.handler(async ({ context, input }) => {
    try {
      const [row] = await db
        .insert(M)
        .values({
          provider: input.provider,
          modelId: input.modelId,
          displayName: input.displayName,
          inputUsdPerMtok: toDecimal(input.inputUsdPerMtok),
          outputUsdPerMtok: toDecimal(input.outputUsdPerMtok),
          qualityScore: input.qualityScore,
          maxDataClass: input.maxDataClass,
          active: input.active,
        })
        .returning({ id: M.id });
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      await audit({
        actorId: context.user.id,
        action: "system.model.create",
        targetType: "model",
        targetId: row.id,
        metadata: { provider: input.provider, modelId: input.modelId },
      });
      return { id: row.id };
    } catch (error) {
      if (isDuplicate(error)) throw new ORPCError("BAD_REQUEST", { message: t("model.exists") });
      throw error;
    }
  }),

  update: systemAdmin.admin.models.update.handler(async ({ context, input }) => {
    const current = await requireModel(input.id);
    const p = input.patch;
    try {
      await db
        .update(M)
        .set({
          ...(p.provider !== undefined && { provider: p.provider }),
          ...(p.modelId !== undefined && { modelId: p.modelId }),
          ...(p.displayName !== undefined && { displayName: p.displayName }),
          ...(p.inputUsdPerMtok !== undefined && { inputUsdPerMtok: toDecimal(p.inputUsdPerMtok) }),
          ...(p.outputUsdPerMtok !== undefined && { outputUsdPerMtok: toDecimal(p.outputUsdPerMtok) }),
          ...(p.qualityScore !== undefined && { qualityScore: p.qualityScore }),
          ...(p.maxDataClass !== undefined && { maxDataClass: p.maxDataClass }),
          ...(p.active !== undefined && { active: p.active }),
        })
        .where(eq(M.id, current.id));
    } catch (error) {
      if (isDuplicate(error)) throw new ORPCError("BAD_REQUEST", { message: t("model.exists") });
      throw error;
    }
    await audit({
      actorId: context.user.id,
      action:
        p.active !== undefined && Object.keys(p).length === 1 ? "system.model.toggle" : "system.model.update",
      targetType: "model",
      targetId: current.id,
      metadata: {
        provider: current.provider,
        modelId: current.modelId,
        ...(p.active !== undefined && { active: p.active }),
      },
    });
    return { ok: true as const };
  }),

  delete: systemAdmin.admin.models.delete.handler(async ({ context, input }) => {
    const current = await requireModel(input.id);
    await db.delete(M).where(eq(M.id, current.id)); // org assignments cascade
    await audit({
      actorId: context.user.id,
      action: "system.model.delete",
      targetType: "model",
      targetId: current.id,
      metadata: { provider: current.provider, modelId: current.modelId },
    });
    return { ok: true as const };
  }),

  forOrg: systemAdmin.admin.models.forOrg.handler(async ({ input }): Promise<OrgModelRow[]> => {
    await requireOrg(input.orgId);
    const rows = await db
      .select({
        modelId: M.id,
        provider: M.provider,
        model: M.modelId,
        displayName: M.displayName,
        maxDataClass: M.maxDataClass,
        active: M.active,
        assignmentId: schema.orgModel.id,
        enabled: schema.orgModel.enabled,
      })
      .from(M)
      .leftJoin(
        schema.orgModel,
        and(eq(schema.orgModel.modelRefId, M.id), eq(schema.orgModel.orgId, input.orgId)),
      )
      .orderBy(asc(M.provider), asc(M.displayName));
    return rows.map((r) => ({
      modelId: r.modelId,
      provider: r.provider,
      model: r.model,
      displayName: r.displayName,
      maxDataClass: r.maxDataClass,
      active: r.active,
      assigned: r.assignmentId !== null,
      enabled: r.assignmentId !== null ? Boolean(r.enabled) : false,
    }));
  }),

  setForOrg: systemAdmin.admin.models.setForOrg.handler(async ({ context, input }) => {
    await requireOrg(input.orgId);
    const model = await requireModel(input.modelId);
    if (input.assigned) {
      await db
        .insert(schema.orgModel)
        .values({ orgId: input.orgId, modelRefId: model.id, enabled: input.enabled })
        .onConflictDoUpdate({
          target: [schema.orgModel.orgId, schema.orgModel.modelRefId],
          set: { enabled: input.enabled },
        });
    } else {
      await db
        .delete(schema.orgModel)
        .where(and(eq(schema.orgModel.orgId, input.orgId), eq(schema.orgModel.modelRefId, model.id)));
    }
    await audit({
      orgId: input.orgId,
      actorId: context.user.id,
      action: "system.org-model.set",
      targetType: "model",
      targetId: model.id,
      metadata: {
        provider: model.provider,
        modelId: model.modelId,
        assigned: input.assigned,
        enabled: input.assigned ? input.enabled : false,
      },
    });
    return { ok: true as const };
  }),
};
