import { schema } from "@orbs/db";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db.ts";
import { t } from "../i18n.ts";
import { inOrg } from "./base.ts";

/** IDs the user has pinned, by kind. */
export async function pinnedIds(orgId: string, userId: string, kind: "thread" | "project") {
  const rows = await db
    .select({ targetId: schema.userPin.targetId })
    .from(schema.userPin)
    .where(
      and(eq(schema.userPin.orgId, orgId), eq(schema.userPin.userId, userId), eq(schema.userPin.kind, kind)),
    );
  return new Set(rows.map((r) => r.targetId));
}

/** Removes every user's pin on a thread or project that no longer exists. */
export async function dropPins(
  orgId: string,
  kind: "thread" | "project",
  targetId: string,
  tx: Pick<typeof db, "delete"> = db,
) {
  await tx
    .delete(schema.userPin)
    .where(
      and(
        eq(schema.userPin.orgId, orgId),
        eq(schema.userPin.kind, kind),
        eq(schema.userPin.targetId, targetId),
      ),
    );
}

export const pinsRouter = {
  set: inOrg.pins.set.handler(async ({ context, input }) => {
    if (input.kind === "thread") {
      // Conversations are private: only the creator can pin one.
      const [row] = await db
        .select({ id: schema.thread.id })
        .from(schema.thread)
        .where(
          and(
            eq(schema.thread.id, input.id),
            eq(schema.thread.orgId, context.orgId),
            eq(schema.thread.createdBy, context.user.id),
          ),
        )
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: t("common.threadNotFound") });
    } else {
      const [row] = await db
        .select({ id: schema.project.id })
        .from(schema.project)
        .where(and(eq(schema.project.id, input.id), eq(schema.project.orgId, context.orgId)))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: t("common.projectNotFound") });
    }
    if (input.pinned) {
      await db
        .insert(schema.userPin)
        .values({ orgId: context.orgId, userId: context.user.id, kind: input.kind, targetId: input.id })
        .onConflictDoNothing();
    } else {
      await db
        .delete(schema.userPin)
        .where(
          and(
            eq(schema.userPin.userId, context.user.id),
            eq(schema.userPin.kind, input.kind),
            eq(schema.userPin.targetId, input.id),
          ),
        );
    }
    return { ok: true as const };
  }),
};
