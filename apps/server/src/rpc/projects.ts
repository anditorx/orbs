import { schema } from "@orbs/db";
import { isOrgAdmin, normalizeRelativePath, type Project, skipReason } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { appendEvent } from "../events.ts";
import { t } from "../i18n.ts";
import { loadFile, removeProject, saveFile } from "../workspaceStorage.ts";
import { inOrg } from "./base.ts";
import { dropPins, pinnedIds } from "./pins.ts";

const MB = 1024 * 1024;
/** Text previews larger than this are truncated. */
const MAX_PREVIEW_BYTES = MB;

const projectColumns = {
  id: schema.project.id,
  name: schema.project.name,
  mode: schema.project.mode,
  createdBy: schema.project.createdBy,
  createdAt: schema.project.createdAt,
  updatedAt: schema.project.updatedAt,
  fileCount: sql<number>`(select count(*)::int from "project_file" f where f.project_id = "project"."id")`,
  totalBytes: sql<number>`(select coalesce(sum(f.size), 0)::bigint from "project_file" f where f.project_id = "project"."id")`,
};

type ProjectRow = {
  id: string;
  createdBy: string | null;
  name: string;
  mode: "work" | "code";
  createdAt: Date;
  updatedAt: Date;
  fileCount: number;
  totalBytes: number | string;
};

function toProject(row: ProjectRow, pinned = false, editable = false): Project {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    fileCount: row.fileCount,
    totalBytes: Number(row.totalBytes),
    pinned,
    editable,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireProject(orgId: string, projectId: string) {
  const [row] = await db
    .select(projectColumns)
    .from(schema.project)
    .where(and(eq(schema.project.id, projectId), eq(schema.project.orgId, orgId)))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: t("common.projectNotFound") });
  return row;
}

/** Heuristic used by editors: a NUL byte in the first 8 KB means "binary". */
function isBinary(bytes: Uint8Array) {
  return bytes.subarray(0, 8192).includes(0);
}

export const projectsRouter = {
  list: inOrg.projects.list.handler(async ({ context, input }) => {
    const rows = await db
      .select(projectColumns)
      .from(schema.project)
      .where(
        input.mode
          ? and(eq(schema.project.orgId, context.orgId), eq(schema.project.mode, input.mode))
          : eq(schema.project.orgId, context.orgId),
      )
      .orderBy(desc(schema.project.updatedAt));
    const pinned = await pinnedIds(context.orgId, context.user.id, "project");
    return rows.map((row) =>
      toProject(row, pinned.has(row.id), row.createdBy === context.user.id || isOrgAdmin(context.role)),
    );
  }),

  create: inOrg.projects.create.handler(async ({ context, input }) => {
    const [row] = await db
      .insert(schema.project)
      .values({ orgId: context.orgId, name: input.name, mode: input.mode, createdBy: context.user.id })
      .returning();
    if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
    await appendEvent({
      orgId: context.orgId,
      streamType: "org",
      streamId: context.orgId,
      type: "project.created",
      payload: { projectId: row.id, name: row.name, mode: row.mode },
      actorId: context.user.id,
    });
    return toProject({ ...row, fileCount: 0, totalBytes: 0 }, false, true);
  }),

  rename: inOrg.projects.rename.handler(async ({ context, input }) => {
    const [row] = await db
      .select({ id: schema.project.id, name: schema.project.name, createdBy: schema.project.createdBy })
      .from(schema.project)
      .where(and(eq(schema.project.id, input.projectId), eq(schema.project.orgId, context.orgId)))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: t("common.projectNotFound") });
    if (row.createdBy !== context.user.id && !isOrgAdmin(context.role)) {
      throw new ORPCError("FORBIDDEN", { message: t("project.renameForbidden") });
    }
    await db.update(schema.project).set({ name: input.name }).where(eq(schema.project.id, row.id));
    // Org-level event so other open tabs and members refresh their lists.
    await appendEvent({
      orgId: context.orgId,
      streamType: "org",
      streamId: context.orgId,
      type: "project.renamed",
      payload: { projectId: row.id, name: input.name },
      actorId: context.user.id,
    });
    await audit({
      orgId: context.orgId,
      actorId: context.user.id,
      action: "project.rename",
      targetType: "project",
      targetId: row.id,
      metadata: { from: row.name, to: input.name },
    });
    return { ok: true as const };
  }),

  uploadFiles: inOrg.projects.uploadFiles.handler(async ({ context, input }) => {
    const project = await requireProject(context.orgId, input.projectId);
    if (project.mode !== "code") throw new ORPCError("BAD_REQUEST", { message: t("project.codeOnly") });

    let fileCount = project.fileCount;
    let totalBytes = Number(project.totalBytes);
    const skipped: Array<{ path: string; reason: string }> = [];
    let saved = 0;

    for (const { path: rawPath, file } of input.files) {
      const path = normalizeRelativePath(rawPath);
      if (!path) {
        skipped.push({ path: rawPath, reason: "invalid-path" });
        continue;
      }
      const reason = skipReason(path);
      if (reason) {
        skipped.push({ path, reason });
        continue;
      }
      if (file.size > env.ORBS_UPLOAD_MAX_FILE_MB * MB) {
        skipped.push({ path, reason: "too-large" });
        continue;
      }
      // Limits use pre-upload totals plus this batch (re-uploading a file counts it again; good enough for quotas).
      if (
        fileCount + 1 > env.ORBS_PROJECT_MAX_FILES ||
        totalBytes + file.size > env.ORBS_PROJECT_MAX_MB * MB
      ) {
        skipped.push({ path, reason: "project-quota" });
        continue;
      }
      const stored = await saveFile(
        context.orgId,
        project.id,
        path,
        new Uint8Array(await file.arrayBuffer()),
      );
      await db
        .insert(schema.projectFile)
        .values({
          orgId: context.orgId,
          projectId: project.id,
          path: stored.path,
          size: stored.size,
          sha256: stored.sha256,
          uploadedBy: context.user.id,
        })
        .onConflictDoUpdate({
          target: [schema.projectFile.projectId, schema.projectFile.path],
          set: {
            size: stored.size,
            sha256: stored.sha256,
            uploadedBy: context.user.id,
            updatedAt: new Date(),
          },
        });
      saved += 1;
      fileCount += 1;
      totalBytes += stored.size;
    }

    await db.update(schema.project).set({ updatedAt: new Date() }).where(eq(schema.project.id, project.id));
    if (saved > 0) {
      await audit({
        orgId: context.orgId,
        actorId: context.user.id,
        action: "project.upload",
        targetType: "project",
        targetId: project.id,
        metadata: { saved, skipped: skipped.length },
      });
    }
    return { saved, skipped };
  }),

  files: inOrg.projects.files.handler(async ({ context, input }) => {
    await requireProject(context.orgId, input.projectId);
    return db
      .select({ path: schema.projectFile.path, size: schema.projectFile.size })
      .from(schema.projectFile)
      .where(
        and(eq(schema.projectFile.orgId, context.orgId), eq(schema.projectFile.projectId, input.projectId)),
      )
      .orderBy(asc(schema.projectFile.path));
  }),

  readFile: inOrg.projects.readFile.handler(async ({ context, input }) => {
    const path = normalizeRelativePath(input.path);
    if (!path) throw new ORPCError("BAD_REQUEST", { message: t("project.invalidPath") });
    const [indexed] = await db
      .select({ path: schema.projectFile.path })
      .from(schema.projectFile)
      .where(
        and(
          eq(schema.projectFile.orgId, context.orgId),
          eq(schema.projectFile.projectId, input.projectId),
          eq(schema.projectFile.path, path),
        ),
      )
      .limit(1);
    if (!indexed) throw new ORPCError("NOT_FOUND", { message: t("project.fileNotFound") });
    const { size, bytes, truncated } = await loadFile(
      context.orgId,
      input.projectId,
      path,
      MAX_PREVIEW_BYTES,
    );
    if (isBinary(bytes)) return { path, size, content: null, binary: true, truncated: false };
    return { path, size, content: new TextDecoder("utf-8").decode(bytes), binary: false, truncated };
  }),

  delete: inOrg.projects.delete.handler(async ({ context, input }) => {
    const [row] = await db
      .select({ id: schema.project.id, createdBy: schema.project.createdBy })
      .from(schema.project)
      .where(and(eq(schema.project.id, input.projectId), eq(schema.project.orgId, context.orgId)))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: t("common.projectNotFound") });
    if (row.createdBy !== context.user.id && !isOrgAdmin(context.role)) {
      throw new ORPCError("FORBIDDEN", {
        message: t("project.deleteForbidden"),
      });
    }
    await db.delete(schema.project).where(eq(schema.project.id, row.id)); // project_file rows cascade
    await dropPins(context.orgId, "project", row.id);
    await removeProject(context.orgId, row.id);
    await audit({
      orgId: context.orgId,
      actorId: context.user.id,
      action: "project.delete",
      targetType: "project",
      targetId: row.id,
    });
    await appendEvent({
      orgId: context.orgId,
      streamType: "org",
      streamId: context.orgId,
      type: "project.deleted",
      payload: { projectId: row.id },
      actorId: context.user.id,
    });
    return { deleted: true as const };
  }),
};
