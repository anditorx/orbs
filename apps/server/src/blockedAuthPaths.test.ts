import { describe, expect, it } from "vitest";
import { isBlockedAuthPath } from "./blockedAuthPaths.ts";

describe("isBlockedAuthPath", () => {
  it("blocks impersonation, takeover, hard delete and company deletion", () => {
    for (const p of [
      "/api/auth/admin/impersonate-user",
      "/api/auth/admin/set-user-password",
      "/api/auth/admin/update-user",
      "/api/auth/admin/remove-user",
      "/api/auth/organization/delete",
      "/api/auth/admin/remove-user/",
    ]) {
      expect(isBlockedAuthPath(p), p).toBe(true);
    }
  });
  it("keeps the endpoints Orbs relies on", () => {
    for (const p of [
      "/api/auth/sign-in/email",
      "/api/auth/admin/ban-user",
      "/api/auth/admin/set-role",
      "/api/auth/organization/invite-member",
      "/api/auth/organization/update",
    ]) {
      expect(isBlockedAuthPath(p), p).toBe(false);
    }
  });
});
