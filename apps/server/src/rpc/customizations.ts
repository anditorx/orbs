import { schema } from "@orbs/db";
import { parseManifest } from "@orbs/plugin-sdk";
import { type Customization, isOrgAdmin } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, or } from "drizzle-orm";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import { t } from "../i18n.ts";
import { inOrg } from "./base.ts";

const C = schema.customization;

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

async function assertProject(orgId: string, projectId: string | null) {
  if (!projectId) return;
  const [row] = await db
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(and(eq(schema.project.id, projectId), eq(schema.project.orgId, orgId)))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: t("common.projectNotFound") });
}

const columns = {
  row: C,
  projectName: schema.project.name,
  ownerName: schema.user.name,
};

function toCustomization(
  r: { row: typeof C.$inferSelect; projectName: string | null; ownerName: string | null },
  viewer: { userId: string; role: string },
): Customization {
  const { row } = r;
  const editable = row.scope === "org" ? isOrgAdmin(viewer.role) : row.ownerId === viewer.userId;
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    projectId: row.projectId,
    projectName: r.projectName,
    ownerId: row.ownerId,
    ownerName: r.ownerName,
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

async function loadOne(id: string, orgId: string, viewer: { userId: string; role: string }) {
  const [r] = await db
    .select(columns)
    .from(C)
    .leftJoin(schema.project, eq(schema.project.id, C.projectId))
    .leftJoin(schema.user, eq(schema.user.id, C.ownerId))
    .where(and(eq(C.id, id), eq(C.orgId, orgId)))
    .limit(1);
  // Other people's personal items are invisible, so report them as missing.
  if (!r || (r.row.scope === "user" && r.row.ownerId !== viewer.userId)) {
    throw new ORPCError("NOT_FOUND", { message: t("custom.notFound") });
  }
  return toCustomization(r, viewer);
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
      .select(columns)
      .from(C)
      .leftJoin(schema.project, eq(schema.project.id, C.projectId))
      .leftJoin(schema.user, eq(schema.user.id, C.ownerId))
      .where(
        and(
          eq(C.orgId, context.orgId),
          or(eq(C.scope, "org"), eq(C.ownerId, context.user.id)),
          input.kind ? eq(C.kind, input.kind) : undefined,
        ),
      )
      .orderBy(asc(C.name));
    return rows.map((r) => toCustomization(r, viewer));
  }),

  create: inOrg.customizations.create.handler(async ({ context, input }) => {
    if (input.scope === "org" && !isOrgAdmin(context.role)) {
      throw new ORPCError("FORBIDDEN", {
        message: t("custom.orgCreateAdminOnly"),
      });
    }
    validateBody(input.kind, input.body);
    await assertProject(context.orgId, input.projectId);
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(C)
        .values({ ...input, orgId: context.orgId, ownerId: context.user.id })
        .returning({ id: C.id });
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      await audit(
        {
          orgId: context.orgId,
          actorId: context.user.id,
          action: "customization.create",
          targetType: input.kind,
          targetId: row.id,
          metadata: { name: input.name, scope: input.scope, projectId: input.projectId },
        },
        tx,
      );
      return row.id;
    });
    return loadOne(id, context.orgId, { userId: context.user.id, role: context.role });
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
    if (patch.scope === "org" && !isOrgAdmin(context.role)) {
      throw new ORPCError("FORBIDDEN", {
        message: t("custom.shareAdminOnly"),
      });
    }
    if (patch.body !== undefined) validateBody(current.kind, patch.body);
    if (patch.projectId !== undefined) await assertProject(context.orgId, patch.projectId);
    const { kind: _kind, ...fields } = patch;
    await db.transaction(async (tx) => {
      await tx
        .update(C)
        .set({ ...fields, version: current.version + 1 })
        .where(and(eq(C.id, input.id), eq(C.orgId, context.orgId)));
      await audit(
        {
          orgId: context.orgId,
          actorId: context.user.id,
          action: "customization.update",
          targetType: current.kind,
          targetId: input.id,
          metadata: { name: patch.name ?? current.name, version: current.version + 1 },
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
