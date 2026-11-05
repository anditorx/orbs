import { schema } from "@orbs/db";
import type { TeamUsageRow } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import {
  budgetStatusFor,
  byDay,
  byModel,
  byProject,
  byThread,
  getFxRate,
  loadBudgets,
  resolvePeriod,
  totalsByUser,
  totalsFor,
} from "../usage.ts";
import { inOrg, orgAdmin } from "./base.ts";

async function requireMember(orgId: string, userId: string) {
  const [row] = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Anggota tidak ditemukan di ruang kerja ini" });
  return row;
}

async function requireProject(orgId: string, projectId: string) {
  const [row] = await db
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(and(eq(schema.project.id, projectId), eq(schema.project.orgId, orgId)))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Proyek tidak ditemukan" });
}

export const usageRouter = {
  mine: inOrg.usage.mine.handler(async ({ context, input }) => {
    const period = resolvePeriod(input.period);
    const f = { userId: context.user.id };
    const [totals, projects, models, days, budgets] = await Promise.all([
      totalsFor(context.orgId, period, f),
      byProject(context.orgId, period, f),
      byModel(context.orgId, period, f),
      byDay(context.orgId, period, f),
      budgetStatusFor(context.orgId, period, [context.user.id]),
    ]);
    return {
      period: period.key,
      totals,
      byProject: projects,
      byModel: models,
      byDay: days,
      budgets: budgets.get(context.user.id) ?? [],
    };
  }),

  team: orgAdmin.usage.team.handler(async ({ context, input }) => {
    const period = resolvePeriod(input.period);
    const orgId = context.orgId;
    const [fx, totals, usage, members] = await Promise.all([
      getFxRate(orgId),
      totalsFor(orgId, period, { projectId: input.projectId }),
      totalsByUser(orgId, period, input.projectId),
      db
        .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, orgId)),
    ]);
    const budgets = await budgetStatusFor(
      orgId,
      period,
      members.map((m) => m.id),
    );
    const byUser = new Map(usage.map((u) => [u.userId, u]));
    const rows: TeamUsageRow[] = members
      .map((m) => {
        const u = byUser.get(m.id);
        const all = budgets.get(m.id) ?? [];
        return {
          userId: m.id,
          name: m.name,
          email: m.email,
          requests: u?.requests ?? 0,
          totalTokens: u?.totalTokens ?? 0,
          costIdr: u?.costIdr ?? 0,
          sharePercent: totals.costIdr > 0 ? Math.round(((u?.costIdr ?? 0) / totals.costIdr) * 100) : 0,
          // When viewing one project, only global budgets and that project's budgets are relevant.
          budgets: input.projectId
            ? all.filter((b) => b.projectId === null || b.projectId === input.projectId)
            : all,
        };
      })
      .sort((a, b) => b.costIdr - a.costIdr || b.totalTokens - a.totalTokens);
    return { period: period.key, projectId: input.projectId, fxUsdIdr: fx, totals, rows };
  }),

  /** Metadata only (project, conversation title, model, counts). Prompt text is never returned. */
  userDetail: orgAdmin.usage.userDetail.handler(async ({ context, input }) => {
    const user = await requireMember(context.orgId, input.userId);
    const period = resolvePeriod(input.period);
    const f = { userId: user.id };
    const [totals, projects, threads, models, budgets] = await Promise.all([
      totalsFor(context.orgId, period, f),
      byProject(context.orgId, period, f),
      byThread(context.orgId, period, f),
      byModel(context.orgId, period, f),
      budgetStatusFor(context.orgId, period, [user.id]),
    ]);
    return {
      user,
      period: period.key,
      totals,
      byProject: projects,
      byThread: threads,
      byModel: models,
      budgets: budgets.get(user.id) ?? [],
    };
  }),

  reset: orgAdmin.usage.reset.handler(async ({ context, input }) => {
    await requireMember(context.orgId, input.userId);
    if (input.projectId) await requireProject(context.orgId, input.projectId);
    await db.transaction(async (tx) => {
      await tx.insert(schema.usageReset).values({
        orgId: context.orgId,
        userId: input.userId,
        projectId: input.projectId,
        resetBy: context.user.id,
        reason: input.reason ?? null,
      });
      await audit(
        {
          orgId: context.orgId,
          actorId: context.user.id,
          action: "usage.reset",
          targetType: "user",
          targetId: input.userId,
          metadata: { projectId: input.projectId, reason: input.reason ?? null },
        },
        tx,
      );
    });
    return { ok: true as const };
  }),

  budgets: {
    list: orgAdmin.usage.budgets.list.handler(async ({ context }) => {
      const period = resolvePeriod(undefined);
      const all = await loadBudgets(context.orgId);
      // Status of a per-user budget is shown for that user; org defaults are shown unused (limit only).
      const users = [...new Set(all.map((b) => b.userId).filter((u): u is string => u !== null))];
      const statuses = await budgetStatusFor(context.orgId, period, users, all);
      return all.map((b) => {
        const status = b.userId ? statuses.get(b.userId)?.find((s) => s.id === b.id) : undefined;
        return (
          status ?? {
            ...b,
            used: 0,
            remaining: b.limit,
            percent: 0,
            exceeded: false,
          }
        );
      });
    }),

    set: orgAdmin.usage.budgets.set.handler(async ({ context, input }) => {
      if (input.userId) await requireMember(context.orgId, input.userId);
      if (input.projectId) await requireProject(context.orgId, input.projectId);
      return db.transaction(async (tx) => {
        const same = and(
          eq(schema.budget.orgId, context.orgId),
          input.userId ? eq(schema.budget.userId, input.userId) : isNull(schema.budget.userId),
          input.projectId ? eq(schema.budget.projectId, input.projectId) : isNull(schema.budget.projectId),
          eq(schema.budget.unit, input.unit),
        );
        const [existing] = await tx.select({ id: schema.budget.id }).from(schema.budget).where(same).limit(1);
        let id: string;
        if (existing) {
          await tx
            .update(schema.budget)
            .set({ limitValue: input.limit })
            .where(eq(schema.budget.id, existing.id));
          id = existing.id;
        } else {
          const [row] = await tx
            .insert(schema.budget)
            .values({
              orgId: context.orgId,
              userId: input.userId,
              projectId: input.projectId,
              unit: input.unit,
              limitValue: input.limit,
              createdBy: context.user.id,
            })
            .returning({ id: schema.budget.id });
          if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
          id = row.id;
        }
        await audit(
          {
            orgId: context.orgId,
            actorId: context.user.id,
            action: "budget.set",
            targetType: "budget",
            targetId: id,
            metadata: { ...input },
          },
          tx,
        );
        return { id };
      });
    }),

    delete: orgAdmin.usage.budgets.delete.handler(async ({ context, input }) => {
      const deleted = await db
        .delete(schema.budget)
        .where(and(eq(schema.budget.id, input.id), eq(schema.budget.orgId, context.orgId)))
        .returning({ id: schema.budget.id });
      if (deleted.length === 0) throw new ORPCError("NOT_FOUND", { message: "Batas tidak ditemukan" });
      await audit({
        orgId: context.orgId,
        actorId: context.user.id,
        action: "budget.delete",
        targetType: "budget",
        targetId: input.id,
      });
      return { ok: true as const };
    }),
  },

  settings: {
    get: orgAdmin.usage.settings.get.handler(async ({ context }) => ({
      fxUsdIdr: await getFxRate(context.orgId),
    })),
    set: orgAdmin.usage.settings.set.handler(async ({ context, input }) => {
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.orgSettings)
          .values({ orgId: context.orgId, data: { fxUsdIdr: input.fxUsdIdr } })
          .onConflictDoUpdate({
            target: schema.orgSettings.orgId,
            set: {
              data: sql`${schema.orgSettings.data} || ${JSON.stringify({ fxUsdIdr: input.fxUsdIdr })}::jsonb`,
            },
          });
        await audit(
          {
            orgId: context.orgId,
            actorId: context.user.id,
            action: "usage.fx.set",
            metadata: { fxUsdIdr: input.fxUsdIdr },
          },
          tx,
        );
      });
      return { fxUsdIdr: input.fxUsdIdr };
    }),
  },
};
