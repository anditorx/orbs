import { schema } from "@orbs/db";
import { parseManifest } from "@orbs/plugin-sdk";
import {
  type AppliesTo,
  type Customization,
  INSTRUCTION_LIMIT,
  type InstructionLike,
  instructionChars,
  instructionUsage,
  mayShareWithWorkspace,
} from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import { activeInstructions } from "../agent/instructions.ts";
import { type InstructionText, instructionSection } from "../agent/prompt.ts";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import { t } from "../i18n.ts";
import { inOrg } from "./base.ts";

const C = schema.customization;
const CP = schema.customizationProject;
const P = schema.project;

/** A plugin's body is its manifest JSON; reject anything the SDK can't parse. */
function validateBody(kind: string, body: string) {
  if (kind !== "plugin") return;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: t("custom.invalidJson") });
  }
  const parsed = parseManifest(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ORPCError("BAD_REQUEST", {
      message: t("custom.invalidManifest", {
        path: issue?.path.join(".") || "manifest",
        detail: issue?.message ?? "",
      }),
    });
  }
}

type Viewer = { userId: string; role: string };
interface LinkedProject {
  id: string;
  name: string;
  createdBy: string | null;
}

/** The projects each customization is limited to. */
async function linksFor(ids: string[]): Promise<Map<string, LinkedProject[]>> {
  const map = new Map<string, LinkedProject[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ customizationId: CP.customizationId, id: P.id, name: P.name, createdBy: P.createdBy })
    .from(CP)
    .innerJoin(P, eq(P.id, CP.projectId))
    .where(inArray(CP.customizationId, ids))
    .orderBy(asc(P.name));
  for (const r of rows) {
    const list = map.get(r.customizationId) ?? [];
    list.push({ id: r.id, name: r.name, createdBy: r.createdBy });
    map.set(r.customizationId, list);
  }
  return map;
}

/** Where something applies, checked: the projects it names must exist in this workspace. */
async function resolveTarget(orgId: string, appliesTo: AppliesTo, projectIds: string[]) {
  if (appliesTo !== "projects") return { appliesTo, projects: [] as LinkedProject[] };
  const wanted = [...new Set(projectIds)];
  if (wanted.length === 0) throw new ORPCError("BAD_REQUEST", { message: t("custom.pickProject") });
  const projects = await db
    .select({ id: P.id, name: P.name, createdBy: P.createdBy })
    .from(P)
    .where(and(eq(P.orgId, orgId), inArray(P.id, wanted)));
  if (projects.length !== wanted.length) {
    throw new ORPCError("NOT_FOUND", { message: t("common.projectNotFound") });
  }
  return { appliesTo, projects };
}

function assertMayShare(
  viewer: Viewer,
  scope: "user" | "org",
  target: { appliesTo: AppliesTo; projects: LinkedProject[] },
) {
  if (scope === "org" && !mayShareWithWorkspace(viewer, target.appliesTo, target.projects)) {
    throw new ORPCError("FORBIDDEN", { message: t("custom.shareScope") });
  }
}

/**
 * What was limited to projects that are now gone has nowhere left to apply, so it goes too, instead of staying in the
 * list applying nowhere. Called after a project is deleted (its links go with it).
 */
export async function removeOrphanedCustomizations(orgId: string) {
  await db
    .delete(C)
    .where(
      and(
        eq(C.orgId, orgId),
        eq(C.appliesTo, "projects"),
        notExists(db.select({ one: sql`1` }).from(CP).where(eq(CP.customizationId, C.id))),
      ),
    );
}

/**
 * An instruction that doesn't fit its level's room in the prompt would be cut off silently, so it is refused when it is
 * saved, with the numbers. Only enabled instructions count (switching one off is always allowed).
 */
export async function assertInstructionRoom(orgId: string, draft: InstructionLike) {
  if (!draft.enabled) return;
  const rows = await db
    .select({
      id: C.id,
      scope: C.scope,
      appliesTo: C.appliesTo,
      ownerId: C.ownerId,
      enabled: C.enabled,
      name: C.name,
      body: C.body,
    })
    .from(C)
    .where(
      and(
        eq(C.orgId, orgId),
        eq(C.kind, "instruction"),
        eq(C.enabled, true),
        // Only the draft's own level takes up its room: the workspace's, or this person's.
        draft.scope === "org"
          ? eq(C.scope, "org")
          : and(eq(C.scope, "user"), eq(C.ownerId, draft.ownerId ?? "")),
      ),
    );
  const links = await linksFor(rows.map((r) => r.id));
  const others: InstructionLike[] = rows.map((r) => ({
    ...r,
    projectIds: (links.get(r.id) ?? []).map((p) => p.id),
  }));
  const { used, limit, tier } = instructionUsage(others, draft);
  if (used > limit) {
    throw new ORPCError("BAD_REQUEST", {
      message: t("custom.instructionTooLong", { tier: t(`custom.tier.${tier}`), limit, used }),
    });
  }
}

function toCustomization(
  row: typeof C.$inferSelect,
  ownerName: string | null,
  projects: LinkedProject[],
  viewer: Viewer,
): Customization {
  const editable =
    row.scope === "org"
      ? mayShareWithWorkspace(viewer, row.appliesTo, projects)
      : row.ownerId === viewer.userId;
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    appliesTo: row.appliesTo,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    ownerId: row.ownerId,
    ownerName,
    name: row.name,
    description: row.description,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    editable,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadOne(id: string, orgId: string, viewer: Viewer) {
  const [r] = await db
    .select({ row: C, ownerName: schema.user.name })
    .from(C)
    .leftJoin(schema.user, eq(schema.user.id, C.ownerId))
    .where(and(eq(C.id, id), eq(C.orgId, orgId)))
    .limit(1);
  // Other people's personal items are invisible, so report them as missing.
  if (!r || (r.row.scope === "user" && r.row.ownerId !== viewer.userId)) {
    throw new ORPCError("NOT_FOUND", { message: t("custom.notFound") });
  }
  const links = await linksFor([id]);
  return toCustomization(r.row, r.ownerName, links.get(id) ?? [], viewer);
}

function assertEditable(item: Customization) {
  if (!item.editable) {
    throw new ORPCError("FORBIDDEN", {
      message: item.scope === "org" ? t("custom.editOrgAdminOnly") : t("custom.editOwnerOnly"),
    });
  }
}

export const customizationsRouter = {
  list: inOrg.customizations.list.handler(async ({ context, input }) => {
    const viewer = { userId: context.user.id, role: context.role };
    const rows = await db
      .select({ row: C, ownerName: schema.user.name })
      .from(C)
      .leftJoin(schema.user, eq(schema.user.id, C.ownerId))
      .where(
        and(
          eq(C.orgId, context.orgId),
          or(eq(C.scope, "org"), eq(C.ownerId, context.user.id)),
          input.kind ? eq(C.kind, input.kind) : undefined,
        ),
      )
      .orderBy(asc(C.name));
    const links = await linksFor(rows.map((r) => r.row.id));
    return rows.map((r) => toCustomization(r.row, r.ownerName, links.get(r.row.id) ?? [], viewer));
  }),

  active: inOrg.customizations.active.handler(async ({ context, input }) => {
    let projectId = input.projectId ?? null;
    if (input.threadId) {
      // Conversations are private to their owner; only the owner may see what applies in one.
      const [thread] = await db
        .select({ projectId: schema.thread.projectId })
        .from(schema.thread)
        .where(
          and(
            eq(schema.thread.id, input.threadId),
            eq(schema.thread.orgId, context.orgId),
            eq(schema.thread.createdBy, context.user.id),
          ),
        )
        .limit(1);
      if (!thread) throw new ORPCError("NOT_FOUND", { message: t("common.threadNotFound") });
      projectId = thread.projectId;
    }
    let projectName: string | null = null;
    if (projectId) {
      const [project] = await db
        .select({ name: P.name })
        .from(P)
        .where(and(eq(P.id, projectId), eq(P.orgId, context.orgId)))
        .limit(1);
      if (!project) throw new ORPCError("NOT_FOUND", { message: t("common.projectNotFound") });
      projectName = project.name;
    }
    const active = await activeInstructions(context.orgId, context.user.id, projectId);
    const texts: InstructionText[] = active.map((i) => ({ scope: i.tier, name: i.name, body: i.body }));
    const { text, fit } = instructionSection(texts);
    const usage = (["org", "project", "user"] as const).map((tier) => ({
      tier,
      used: Math.min(
        INSTRUCTION_LIMIT[tier],
        texts
          .filter((i) => i.scope === tier && fit.get(i) !== "left_out")
          .reduce((n, i) => n + instructionChars(i.name, i.body), 0),
      ),
      limit: INSTRUCTION_LIMIT[tier],
    }));
    return {
      projectId,
      projectName,
      items: active.map((i, n) => ({
        id: i.id,
        name: i.name,
        tier: i.tier,
        scope: i.scope,
        appliesTo: i.appliesTo,
        ownerName: i.ownerName,
        projectNames: i.projectNames,
        chars: instructionChars(i.name, i.body),
        fit: fit.get(texts[n] as InstructionText) ?? "whole",
      })),
      usage,
      text: text ?? "",
    };
  }),

  create: inOrg.customizations.create.handler(async ({ context, input }) => {
    const viewer = { userId: context.user.id, role: context.role };
    const target = await resolveTarget(context.orgId, input.appliesTo, input.projectIds);
    assertMayShare(viewer, input.scope, target);
    validateBody(input.kind, input.body);
    if (input.kind === "instruction") {
      await assertInstructionRoom(context.orgId, {
        scope: input.scope,
        appliesTo: target.appliesTo,
        projectIds: target.projects.map((p) => p.id),
        ownerId: context.user.id,
        enabled: input.enabled,
        name: input.name,
        body: input.body,
      });
    }
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(C)
        .values({
          orgId: context.orgId,
          ownerId: context.user.id,
          kind: input.kind,
          scope: input.scope,
          appliesTo: target.appliesTo,
          name: input.name,
          description: input.description,
          body: input.body,
          enabled: input.enabled,
        })
        .returning({ id: C.id });
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      if (target.projects.length > 0) {
        await tx
          .insert(CP)
          .values(target.projects.map((p) => ({ customizationId: row.id, projectId: p.id })));
      }
      await audit(
        {
          orgId: context.orgId,
          actorId: context.user.id,
          action: "customization.create",
          targetType: input.kind,
          targetId: row.id,
          metadata: {
            name: input.name,
            scope: input.scope,
            appliesTo: target.appliesTo,
            projectIds: target.projects.map((p) => p.id),
          },
        },
        tx,
      );
      return row.id;
    });
    return loadOne(id, context.orgId, viewer);
  }),

  update: inOrg.customizations.update.handler(async ({ context, input }) => {
    const viewer = { userId: context.user.id, role: context.role };
    const current = await loadOne(input.id, context.orgId, viewer);
    assertEditable(current);
    const patch = input.patch;
    // The kind never changes, so a plugin always keeps a manifest body.
    if (patch.kind && patch.kind !== current.kind) {
      throw new ORPCError("BAD_REQUEST", { message: t("custom.kindFixed") });
    }
    const scope = patch.scope ?? current.scope;
    const target = await resolveTarget(
      context.orgId,
      patch.appliesTo ?? current.appliesTo,
      patch.projectIds ?? current.projects.map((p) => p.id),
    );
    assertMayShare(viewer, scope, target);
    if (patch.body !== undefined) validateBody(current.kind, patch.body);
    if (current.kind === "instruction") {
      await assertInstructionRoom(context.orgId, {
        id: current.id,
        scope,
        appliesTo: target.appliesTo,
        projectIds: target.projects.map((p) => p.id),
        ownerId: current.ownerId,
        enabled: patch.enabled ?? current.enabled,
        name: patch.name ?? current.name,
        body: patch.body ?? current.body,
      });
    }
    const { kind: _kind, projectIds: _ids, ...fields } = patch;
    await db.transaction(async (tx) => {
      await tx
        .update(C)
        .set({ ...fields, appliesTo: target.appliesTo, version: current.version + 1 })
        .where(and(eq(C.id, input.id), eq(C.orgId, context.orgId)));
      await tx.delete(CP).where(eq(CP.customizationId, input.id));
      if (target.projects.length > 0) {
        await tx
          .insert(CP)
          .values(target.projects.map((p) => ({ customizationId: input.id, projectId: p.id })));
      }
      await audit(
        {
          orgId: context.orgId,
          actorId: context.user.id,
          action: "customization.update",
          targetType: current.kind,
          targetId: input.id,
          metadata: {
            name: patch.name ?? current.name,
            version: current.version + 1,
            appliesTo: target.appliesTo,
            projectIds: target.projects.map((p) => p.id),
          },
        },
        tx,
      );
    });
    return loadOne(input.id, context.orgId, viewer);
  }),

  delete: inOrg.customizations.delete.handler(async ({ context, input }) => {
    const current = await loadOne(input.id, context.orgId, { userId: context.user.id, role: context.role });
    assertEditable(current);
    await db.transaction(async (tx) => {
      await tx.delete(C).where(and(eq(C.id, input.id), eq(C.orgId, context.orgId)));
      await audit(
        {
          orgId: context.orgId,
          actorId: context.user.id,
          action: "customization.delete",
          targetType: current.kind,
          targetId: input.id,
          metadata: { name: current.name },
        },
        tx,
      );
    });
    return { deleted: true as const };
  }),
};
