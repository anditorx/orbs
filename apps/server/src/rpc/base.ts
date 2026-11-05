import { schema } from "@orbs/db";
import { contract } from "@orbs/protocol";
import { implement, ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { auth } from "../auth.ts";
import { db } from "../db.ts";

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
  if (!orgId) throw new ORPCError("PRECONDITION_FAILED", { message: "No active organization" });
  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, context.user.id)))
    .limit(1);
  if (!membership) throw new ORPCError("FORBIDDEN", { message: "Not a member of this organization" });
  return next({ context: { orgId, role: membership.role } });
});

/** Requires an Orbs system administrator (user.role = "admin"). */
export const systemAdmin = authed.use(async ({ context, next }) => {
  if (context.user.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Khusus administrator sistem" });
  }
  return next();
});
