import { schema } from "@orbs/db";
import type { AdminOrgDetail } from "@orbs/protocol";
import { ORG_ROLE, SYSTEM_ROLE } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, asc, count, eq, gt, ne, sql } from "drizzle-orm";
import { audit } from "../audit.ts";
import { auth } from "../auth.ts";
import { db } from "../db.ts";
import { removeProject } from "../workspaceStorage.ts";
import { systemAdmin } from "./base.ts";

/**
 * God-mode administration for Orbs system administrators. Everything here works on any company
 * without membership, bypasses the "last admin" guard, and is written to the audit log.
 * What it deliberately cannot do is read conversation content: nothing here touches threads or events,
 * and impersonation stays disabled (see blockedAuthPaths.ts).
 */

/** Better-Auth admin endpoints throw APIError; surface their message to the admin UI. */
async function callAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permintaan ditolak";
    throw new ORPCError("BAD_REQUEST", { message });
  }
}

async function requireOrg(orgId: string) {
  const [org] = await db
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  if (!org) throw new ORPCError("NOT_FOUND", { message: "Perusahaan tidak ditemukan" });
  return org;
}

async function requireUser(userId: string) {
  const [user] = await db
    .select({ id: schema.user.id, email: schema.user.email, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!user) throw new ORPCError("NOT_FOUND", { message: "Pengguna tidak ditemukan" });
  return user;
}

const INVITATION_TTL_MS = 7 * 24 * 3_600_000;

export const adminOrgManagement = {
  detail: systemAdmin.admin.orgs.detail.handler(async ({ input }): Promise<AdminOrgDetail> => {
    const org = await requireOrg(input.orgId);
    const [members, invitations] = await Promise.all([
      db
        .select({
          memberId: schema.member.id,
          userId: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, org.id))
        .orderBy(asc(schema.user.name)),
      db
        .select({
          id: schema.invitation.id,
          email: schema.invitation.email,
          role: schema.invitation.role,
          expiresAt: schema.invitation.expiresAt,
        })
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.organizationId, org.id),
            eq(schema.invitation.status, "pending"),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        ),
    ]);
    return {
      ...org,
      members,
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role ?? ORG_ROLE.member,
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }),

  rename: systemAdmin.admin.orgs.rename.handler(async ({ context, input }) => {
    const org = await requireOrg(input.orgId);
    await db.update(schema.organization).set({ name: input.name }).where(eq(schema.organization.id, org.id));
    await audit({
      orgId: org.id,
      actorId: context.user.id,
      action: "system.org.rename",
      targetType: "organization",
      targetId: org.id,
      metadata: { from: org.name, to: input.name },
    });
    return { ok: true as const };
  }),

  delete: systemAdmin.admin.orgs.delete.handler(async ({ context, input }) => {
    const org = await requireOrg(input.orgId);
    if (input.confirmName.trim() !== org.name) {
      throw new ORPCError("BAD_REQUEST", { message: "Nama perusahaan tidak cocok. Penghapusan dibatalkan." });
    }
    const projects = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.orgId, org.id));
    await db.transaction(async (tx) => {
      // Keep this company's audit trail: audit rows would otherwise cascade away with it.
      await tx
        .update(schema.auditLog)
        .set({
          orgId: null,
          metadata: sql`${schema.auditLog.metadata} || ${JSON.stringify({ deletedOrgId: org.id, deletedOrgName: org.name })}::jsonb`,
        })
        .where(eq(schema.auditLog.orgId, org.id));
      await tx
        .update(schema.session)
        .set({ activeOrganizationId: null })
        .where(eq(schema.session.activeOrganizationId, org.id));
      await tx.delete(schema.organization).where(eq(schema.organization.id, org.id));
      await audit(
        {
          actorId: context.user.id,
          action: "system.org.delete",
          targetType: "organization",
          targetId: org.id,
          metadata: { name: org.name, projects: projects.length },
        },
        tx,
      );
    });
    // Files live outside the database; remove them after the rows are gone.
    await Promise.all(projects.map((p) => removeProject(org.id, p.id).catch(() => undefined)));
    return { ok: true as const };
  }),

  enter: systemAdmin.admin.orgs.enter.handler(async ({ context, input }) => {
    const org = await requireOrg(input.orgId);
    await db
      .update(schema.session)
      .set({ activeOrganizationId: org.id })
      .where(eq(schema.session.id, context.session.id));
    await audit({
      orgId: org.id,
      actorId: context.user.id,
      action: "system.org.enter",
      targetType: "organization",
      targetId: org.id,
    });
    return { ok: true as const };
  }),

  invite: systemAdmin.admin.orgs.invite.handler(async ({ context, input }) => {
    const org = await requireOrg(input.orgId);
    const email = input.email.trim().toLowerCase();
    const [existing] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(and(eq(schema.member.organizationId, org.id), eq(sql`lower(${schema.user.email})`, email)))
      .limit(1);
    if (existing) throw new ORPCError("BAD_REQUEST", { message: "Orang ini sudah menjadi anggota." });
    const [row] = await db
      .insert(schema.invitation)
      .values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        email,
        role: input.role,
        status: "pending",
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        inviterId: context.user.id,
      })
      .returning({ id: schema.invitation.id });
    if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
    await audit({
      orgId: org.id,
      actorId: context.user.id,
      action: "system.org.invite",
      targetType: "invitation",
      targetId: row.id,
      metadata: { role: input.role },
    });
    return { invitationId: row.id };
  }),

  setMemberRole: systemAdmin.admin.orgs.setMemberRole.handler(async ({ context, input }) => {
    const org = await requireOrg(input.orgId);
    const updated = await db
      .update(schema.member)
      .set({ role: input.role })
      .where(and(eq(schema.member.id, input.memberId), eq(schema.member.organizationId, org.id)))
      .returning({ userId: schema.member.userId });
    if (updated.length === 0) throw new ORPCError("NOT_FOUND", { message: "Anggota tidak ditemukan" });
    await audit({
      orgId: org.id,
      actorId: context.user.id,
      action: "system.org.set-member-role",
      targetType: "user",
      targetId: updated[0]?.userId,
      metadata: { role: input.role },
    });
    return { ok: true as const };
  }),

  removeMember: systemAdmin.admin.orgs.removeMember.handler(async ({ context, input }) => {
    const org = await requireOrg(input.orgId);
    const removed = await db
      .delete(schema.member)
      .where(and(eq(schema.member.id, input.memberId), eq(schema.member.organizationId, org.id)))
      .returning({ userId: schema.member.userId });
    if (removed.length === 0) throw new ORPCError("NOT_FOUND", { message: "Anggota tidak ditemukan" });
    // Drop sessions that still point at this company so the person isn't left inside it.
    await db
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(schema.session.userId, removed[0]?.userId ?? ""),
          eq(schema.session.activeOrganizationId, org.id),
        ),
      );
    await audit({
      orgId: org.id,
      actorId: context.user.id,
      action: "system.org.remove-member",
      targetType: "user",
      targetId: removed[0]?.userId,
    });
    return { ok: true as const };
  }),
};

export const adminUserManagement = {
  setPassword: systemAdmin.admin.users.setPassword.handler(async ({ context, input }) => {
    const target = await requireUser(input.userId);
    await callAuth(() =>
      auth.api.setUserPassword({
        body: { userId: target.id, newPassword: input.password },
        headers: context.headers,
      }),
    );
    // Sign the account out everywhere so the old password stops working immediately.
    await callAuth(() =>
      auth.api.revokeUserSessions({ body: { userId: target.id }, headers: context.headers }),
    );
    await audit({
      actorId: context.user.id,
      action: "system.user.set-password",
      targetType: "user",
      targetId: target.id,
    });
    return { ok: true as const };
  }),

  setEmail: systemAdmin.admin.users.setEmail.handler(async ({ context, input }) => {
    const target = await requireUser(input.userId);
    const email = input.email.trim().toLowerCase();
    const [taken] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(sql`lower(${schema.user.email})`, email), ne(schema.user.id, target.id)))
      .limit(1);
    if (taken) throw new ORPCError("BAD_REQUEST", { message: "Email itu sudah dipakai akun lain." });
    await db.update(schema.user).set({ email, emailVerified: false }).where(eq(schema.user.id, target.id));
    await db.delete(schema.session).where(eq(schema.session.userId, target.id));
    await audit({
      actorId: context.user.id,
      action: "system.user.set-email",
      targetType: "user",
      targetId: target.id,
    });
    return { ok: true as const };
  }),

  delete: systemAdmin.admin.users.delete.handler(async ({ context, input }) => {
    const target = await requireUser(input.userId);
    if (target.id === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "Kamu tidak bisa menghapus akunmu sendiri." });
    }
    if (target.role === SYSTEM_ROLE.admin) {
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(schema.user)
        .where(and(eq(schema.user.role, SYSTEM_ROLE.admin), ne(schema.user.id, target.id)));
      if (n === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Harus ada minimal satu administrator sistem." });
      }
    }
    await callAuth(() => auth.api.removeUser({ body: { userId: target.id }, headers: context.headers }));
    await audit({
      actorId: context.user.id,
      action: "system.user.delete",
      targetType: "user",
      targetId: target.id,
      metadata: { email: target.email },
    });
    return { ok: true as const };
  }),
};
