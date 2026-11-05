import { schema } from "@orbs/db";
import { isOrgAdmin, isSystemAdmin, ORG_ADMIN_ROLE_SQL_PATTERN, ORG_ROLE, SYSTEM_ROLE } from "@orbs/protocol";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin, organization } from "better-auth/plugins";
import { adminAc as systemAdminAc, userAc } from "better-auth/plugins/admin/access";
import { memberAc, adminAc as orgAdminAc } from "better-auth/plugins/organization/access";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { t } from "./i18n.ts";
import { decideSignup, parseDomains } from "./signupPolicy.ts";

const allowedDomains = parseDomains(env.ORBS_SIGNUP_DOMAINS);

/** Header the web app sends when someone signs up from an invitation link (/invite/<id>). */
export const INVITATION_HEADER = "x-orbs-invitation";

/**
 * Enforces ORBS_SIGNUP_MODE before any account row is written.
 * In invite-only mode the sign-up must carry the invitation id from the invite link and the
 * email must match that invitation: knowing an invited email address alone is not enough.
 * Returns true when this is the first account of the install (it becomes system admin).
 */
async function assertSignupAllowed(email: string, invitationId: string | null): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.user);
  const [invite] =
    env.ORBS_SIGNUP_MODE === "invite-only" && invitationId
      ? await db
          .select({ id: schema.invitation.id })
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.id, invitationId),
              eq(sql`lower(${schema.invitation.email})`, normalized),
              eq(schema.invitation.status, "pending"),
              gt(schema.invitation.expiresAt, new Date()),
            ),
          )
          .limit(1)
      : [];
  const decision = decideSignup({
    mode: env.ORBS_SIGNUP_MODE,
    allowedDomains,
    email: normalized,
    isFirstUser: count === 0,
    hasPendingInvite: Boolean(invite),
  });
  if (!decision.allowed) throw new APIError("FORBIDDEN", { message: decision.reason });
  return count === 0;
}

/**
 * A company must always keep at least one administrator. Called before a member is removed
 * or demoted; `memberId` is the member who would stop being an administrator.
 */
async function assertAnotherAdminRemains(organizationId: string, memberId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        sql`${schema.member.id} <> ${memberId}`,
        sql`${schema.member.role} ~ ${ORG_ADMIN_ROLE_SQL_PATTERN}`,
      ),
    );
  if ((row?.n ?? 0) === 0) {
    throw new APIError("BAD_REQUEST", {
      message: t("auth.lastAdmin"),
    });
  }
}

/**
 * Better-Auth's "leave organization" endpoint does not run the remove-member hook, so the
 * HTTP layer calls this before letting an administrator walk out of a company.
 */
export async function assertCanLeaveOrganization(headers: Headers, organizationId: string) {
  const session = await auth.api.getSession({ headers });
  if (!session) return;
  const [membership] = await db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, session.user.id)))
    .limit(1);
  if (membership && isOrgAdmin(membership.role)) {
    await assertAnotherAdminRemains(organizationId, membership.id);
  }
}

const KNOWN_ORG_ROLES = new Set<string>([ORG_ROLE.admin, ORG_ROLE.member]);

function assertKnownOrgRole(role: string | undefined) {
  const roles = (role ?? "").split(",").map((r) => r.trim());
  if (roles.length === 0 || roles.some((r) => !KNOWN_ORG_ROLES.has(r))) {
    throw new APIError("BAD_REQUEST", { message: t("auth.unknownRole") });
  }
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.ORBS_WEB_URL],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  plugins: [
    organization({
      teams: { enabled: true },
      // Companies are created by Orbs system administrators only; everyone else joins by invitation.
      allowUserToCreateOrganization: (user) => isSystemAdmin(user.role),
      // Two company roles only. org.admin is also the creator role, so every company administrator
      // can manage the others; the last-admin guard below keeps at least one in place.
      creatorRole: ORG_ROLE.admin,
      roles: { [ORG_ROLE.admin]: orgAdminAc, [ORG_ROLE.member]: memberAc },
      organizationHooks: {
        // Only the two company roles may ever be stored; the plugin itself accepts any string.
        beforeCreateInvitation: async ({ invitation }) => assertKnownOrgRole(invitation.role),
        beforeAddMember: async ({ member }) => assertKnownOrgRole(member.role),
        beforeRemoveMember: async ({ member, organization }) => {
          if (isOrgAdmin(member.role)) await assertAnotherAdminRemains(organization.id, member.id);
        },
        beforeUpdateMemberRole: async ({ member, newRole, organization }) => {
          assertKnownOrgRole(newRole);
          if (isOrgAdmin(member.role) && !isOrgAdmin(newRole)) {
            await assertAnotherAdminRemains(organization.id, member.id);
          }
        },
      },
    }),
    // System administration: user.role = "system.admin" manages the whole install.
    admin({
      defaultRole: SYSTEM_ROLE.user,
      adminRoles: [SYSTEM_ROLE.admin],
      roles: { [SYSTEM_ROLE.admin]: systemAdminAc, [SYSTEM_ROLE.user]: userAc },
      bannedUserMessage: "Your account has been blocked by an administrator. Contact an admin for help.",
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          // Accounts created by a system admin (/admin/create-user) bypass the self sign-up policy;
          // that endpoint is already restricted to admins by the admin plugin.
          if (context?.path?.startsWith("/admin/")) return;
          const invitationId =
            context?.headers?.get(INVITATION_HEADER) ??
            context?.request?.headers.get(INVITATION_HEADER) ??
            null;
          const isFirstUser = await assertSignupAllowed(user.email, invitationId);
          if (isFirstUser) return { data: { ...user, role: SYSTEM_ROLE.admin } };
        },
      },
    },
  },
});

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
