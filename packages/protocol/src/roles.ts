/**
 * The three Orbs roles, in one place so server, web and database migrations agree on the names.
 *
 * - `system.admin`  an Orbs system administrator (user.role): manages the whole installation.
 * - `org.admin`     a company administrator (member.role): manages one company.
 * - `org.member`    an ordinary company user (member.role).
 *
 * A person without a system role keeps the neutral account role `user`.
 */
export const SYSTEM_ROLE = { admin: "system.admin", user: "user" } as const;
export const ORG_ROLE = { admin: "org.admin", member: "org.member" } as const;

export type SystemRoleName = (typeof SYSTEM_ROLE)[keyof typeof SYSTEM_ROLE];
export type OrgRoleName = (typeof ORG_ROLE)[keyof typeof ORG_ROLE];

/** Better-Auth may store several roles as a comma-separated list. */
function hasRole(roles: string | null | undefined, wanted: string): boolean {
  return (roles ?? "")
    .split(",")
    .map((r) => r.trim())
    .includes(wanted);
}

export const isSystemAdmin = (role: string | null | undefined) => hasRole(role, SYSTEM_ROLE.admin);
export const isOrgAdmin = (role: string | null | undefined) => hasRole(role, ORG_ROLE.admin);

/** Postgres regex matching `member.role` values that include `org.admin`. */
export const ORG_ADMIN_ROLE_SQL_PATTERN = "(^|,)org\\.admin(,|$)";

export const ORG_ROLE_LABEL: Record<string, string> = {
  [ORG_ROLE.admin]: "Admin",
  [ORG_ROLE.member]: "Anggota",
};
