import { schema } from "@orbs/db";
import { contract, isOrgAdmin, isSystemAdmin, ORG_ROLE } from "@orbs/protocol";
import { implement, ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { auth } from "../auth.ts";
import { db } from "../db.ts";
import { t } from "../i18n.ts";

export interface RequestContext {
  headers: Headers;
}

export const os = implement(contract).$context<RequestContext>();

/** Requires a signed-in user. */
export const authed = os.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session) throw new ORPCError("UNAUTHORIZED");
  return next({ context: { user: session.user, session: session.session } });
});

/** Requires an active organization the user belongs to; exposes `orgId` and `role`. */
export const inOrg = authed.use(async ({ context, next }) => {
  const orgId = context.session.activeOrganizationId;
  if (!orgId) throw new ORPCError("PRECONDITION_FAILED", { message: t("common.noActiveOrg") });
  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, context.user.id)))
    .limit(1);
  if (membership) return next({ context: { orgId, role: membership.role } });
  // System administrators may work inside any company without being a member; there they act
  // as company administrators. (Conversation content stays private: it is filtered by owner.)
  if (isSystemAdmin(context.user.role)) {
    const [org] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId))
      .limit(1);
    if (org) return next({ context: { orgId, role: ORG_ROLE.admin } });
  }
  throw new ORPCError("FORBIDDEN", { message: t("common.notMember") });
});

/** Requires an Orbs system administrator (user.role = "system.admin"). */
export const systemAdmin = authed.use(async ({ context, next }) => {
  if (!isSystemAdmin(context.user.role)) {
    throw new ORPCError("FORBIDDEN", { message: t("common.systemAdminOnly") });
  }
  return next();
});

/**
 * Requires an administrator: an owner/admin of the active organization, or an Orbs system
 * administrator (user.role = "system.admin"), who may act in any organization without being a member.
 */
export const orgAdmin = authed.use(async ({ context, next }) => {
  const orgId = context.session.activeOrganizationId;
  if (!orgId) throw new ORPCError("PRECONDITION_FAILED", { message: t("common.noActiveOrg") });
  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, context.user.id)))
    .limit(1);
  if (!isSystemAdmin(context.user.role) && !isOrgAdmin(membership?.role)) {
    throw new ORPCError("FORBIDDEN", { message: t("common.adminOnly") });
  }
  return next({ context: { orgId, role: membership?.role ?? ORG_ROLE.admin } });
});
