import { schema } from "@orbs/db";
import { type AdminOrg, type AdminUser, type AuditEntry, isSystemAdmin, SYSTEM_ROLE } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { audit } from "../audit.ts";
import { auth } from "../auth.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { parseDomains } from "../signupPolicy.ts";
import { resolvePeriod } from "../usage.ts";
import { adminOrgManagement, adminUserManagement } from "./adminManage.ts";
import { systemAdmin } from "./base.ts";

/** Better-Auth admin endpoints throw APIError; surface their message to the admin UI. */
async function callAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permintaan ditolak";
    throw new ORPCError("BAD_REQUEST", { message });
  }
}

async function countAdmins(excludeUserId?: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.user)
    .where(
      excludeUserId
        ? and(eq(schema.user.role, SYSTEM_ROLE.admin), ne(schema.user.id, excludeUserId))
        : eq(schema.user.role, SYSTEM_ROLE.admin),
    );
  return row?.n ?? 0;
}

export const adminRouter = {
  overview: systemAdmin.admin.overview.handler(async () => {
    const [[users], [admins], [banned], [orgs], [threads]] = await Promise.all([
      db.select({ n: count() }).from(schema.user),
      db.select({ n: count() }).from(schema.user).where(eq(schema.user.role, SYSTEM_ROLE.admin)),
      db.select({ n: count() }).from(schema.user).where(eq(schema.user.banned, true)),
      db.select({ n: count() }).from(schema.organization),
      db.select({ n: count() }).from(schema.thread),
    ]);
    return {
      users: users?.n ?? 0,
      admins: admins?.n ?? 0,
      bannedUsers: banned?.n ?? 0,
      organizations: orgs?.n ?? 0,
      threads: threads?.n ?? 0,
      signupMode: env.ORBS_SIGNUP_MODE,
      signupDomains: parseDomains(env.ORBS_SIGNUP_DOMAINS),
    };
  }),

  users: {
    ...adminUserManagement,
    list: systemAdmin.admin.users.list.handler(async ({ input }) => {
      const term = input.search ? `%${input.search}%` : undefined;
      const rows = await db
        .select({
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          role: schema.user.role,
          banned: schema.user.banned,
          banReason: schema.user.banReason,
          createdAt: schema.user.createdAt,
          // Fully qualified outer column: inside a select, drizzle renders `${schema.user.id}` unqualified.
          orgCount: sql<number>`(select count(*)::int from "member" m where m.user_id = "user"."id")`,
        })
        .from(schema.user)
        .where(term ? or(ilike(schema.user.name, term), ilike(schema.user.email, term)) : undefined)
        .orderBy(desc(schema.user.createdAt))
        .limit(500);
      return rows.map(
        (r): AdminUser => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: isSystemAdmin(r.role) ? SYSTEM_ROLE.admin : SYSTEM_ROLE.user,
          banned: Boolean(r.banned),
          banReason: r.banReason,
          createdAt: r.createdAt.toISOString(),
          orgCount: r.orgCount,
        }),
      );
    }),

    create: systemAdmin.admin.users.create.handler(async ({ context, input }) => {
      const result = await callAuth(() =>
        auth.api.createUser({
          body: { name: input.name, email: input.email, password: input.password, role: input.role },
          headers: context.headers,
        }),
      );
      await audit({
        actorId: context.user.id,
        action: "system.user.create",
        targetType: "user",
        targetId: result.user.id,
        metadata: { role: input.role },
      });
      return { id: result.user.id };
    }),

    setRole: systemAdmin.admin.users.setRole.handler(async ({ context, input }) => {
      if (input.role !== SYSTEM_ROLE.admin) {
        if (input.userId === context.user.id) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Kamu tidak bisa mencabut peran admin dirimu sendiri.",
          });
        }
        if ((await countAdmins(input.userId)) === 0) {
          throw new ORPCError("BAD_REQUEST", { message: "Harus ada minimal satu administrator sistem." });
        }
      }
      await callAuth(() =>
        auth.api.setRole({ body: { userId: input.userId, role: input.role }, headers: context.headers }),
      );
      await audit({
        actorId: context.user.id,
        action: "system.user.set-role",
        targetType: "user",
        targetId: input.userId,
        metadata: { role: input.role },
      });
      return { ok: true as const };
    }),

    ban: systemAdmin.admin.users.ban.handler(async ({ context, input }) => {
      await callAuth(() =>
        auth.api.banUser({
          body: { userId: input.userId, ...(input.reason ? { banReason: input.reason } : {}) },
          headers: context.headers,
        }),
      );
      await audit({
        actorId: context.user.id,
        action: "system.user.ban",
        targetType: "user",
        targetId: input.userId,
      });
      return { ok: true as const };
    }),

    unban: systemAdmin.admin.users.unban.handler(async ({ context, input }) => {
      await callAuth(() => auth.api.unbanUser({ body: { userId: input.userId }, headers: context.headers }));
      await audit({
        actorId: context.user.id,
        action: "system.user.unban",
        targetType: "user",
        targetId: input.userId,
      });
      return { ok: true as const };
    }),
  },

  orgs: {
    ...adminOrgManagement,
    list: systemAdmin.admin.orgs.list.handler(async () => {
      const month = resolvePeriod(undefined);
      const monthStart = month.start.toISOString();
      const monthEnd = month.end.toISOString();
      const rows = await db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          createdAt: schema.organization.createdAt,
          memberCount: sql<number>`(select count(*)::int from "member" m where m.organization_id = "organization"."id")`,
          threadCount: sql<number>`(select count(*)::int from "thread" t where t.org_id = "organization"."id")`,
          monthTokens: sql<number>`(select coalesce(sum(l.input_tokens + l.output_tokens), 0)::float8 from "usage_ledger" l where l.org_id = "organization"."id" and l.created_at >= ${monthStart}::timestamptz and l.created_at < ${monthEnd}::timestamptz)`,
          monthCostIdr: sql<number>`(select coalesce(sum(l.cost_idr), 0)::float8 from "usage_ledger" l where l.org_id = "organization"."id" and l.created_at >= ${monthStart}::timestamptz and l.created_at < ${monthEnd}::timestamptz)`,
        })
        .from(schema.organization)
        .orderBy(desc(schema.organization.createdAt))
        .limit(500);
      return rows.map((r): AdminOrg => ({ ...r, createdAt: r.createdAt.toISOString() }));
    }),
  },

  audit: {
    list: systemAdmin.admin.audit.list.handler(async ({ input }) => {
      const rows = await db
        .select({
          id: schema.auditLog.id,
          action: schema.auditLog.action,
          actorEmail: schema.user.email,
          orgName: schema.organization.name,
          targetType: schema.auditLog.targetType,
          targetId: schema.auditLog.targetId,
          createdAt: schema.auditLog.createdAt,
        })
        .from(schema.auditLog)
        .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
        .leftJoin(schema.organization, eq(schema.organization.id, schema.auditLog.orgId))
        .orderBy(desc(schema.auditLog.id))
        .limit(input.limit);
      return rows.map((r): AuditEntry => ({ ...r, createdAt: r.createdAt.toISOString() }));
    }),
  },
};
