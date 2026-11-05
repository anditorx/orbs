/**
 * Better-Auth endpoints that Orbs does not expose directly, even to administrators.
 * System administrators do these things (password/email changes, account and company removal)
 * through Orbs' own audited admin API (see rpc/adminManage.ts). Impersonation has no replacement
 * on purpose: acting as another person would bypass the rule that conversation content is private.
 * Blocked at the HTTP layer so no client (UI or hand-written request) can reach them.
 */
const BLOCKED = new Set([
  "/admin/impersonate-user", // acting as another user, unaudited
  "/admin/set-user-password", // account takeover
  "/admin/update-user", // can rewrite the email of any account
  "/admin/remove-user", // hard delete (Orbs bans accounts instead)
  "/organization/delete", // deleting a company is a system-level operation, not a company-admin one
]);

/** `pathname` is the full request path, e.g. "/api/auth/admin/impersonate-user". */
export function isBlockedAuthPath(pathname: string): boolean {
  const path = pathname.replace(/^\/api\/auth/, "").replace(/\/+$/, "");
  return BLOCKED.has(path);
}
