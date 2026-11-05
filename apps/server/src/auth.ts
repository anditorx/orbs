import { schema } from "@orbs/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin, organization } from "better-auth/plugins";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { env } from "./env.ts";
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

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.ORBS_WEB_URL],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  plugins: [
    organization({ teams: { enabled: true } }),
    // System administration ("superadmin"): user.role = "admin" manages the whole install.
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      bannedUserMessage: "Akun kamu diblokir oleh administrator. Hubungi admin untuk bantuan.",
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
          if (isFirstUser) return { data: { ...user, role: "admin" } };
        },
      },
    },
  },
});

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
