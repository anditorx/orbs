import { describe, expect, it } from "vitest";
import { isOrgAdmin, isSystemAdmin, ORG_ADMIN_ROLE_SQL_PATTERN, ORG_ROLE, SYSTEM_ROLE } from "./roles.ts";

describe("role helpers", () => {
  it("recognises system.admin only by its exact name", () => {
    expect(isSystemAdmin(SYSTEM_ROLE.admin)).toBe(true);
    expect(isSystemAdmin("admin")).toBe(false);
    expect(isSystemAdmin("user")).toBe(false);
    expect(isSystemAdmin(null)).toBe(false);
  });
  it("recognises org.admin, including inside a role list", () => {
    expect(isOrgAdmin(ORG_ROLE.admin)).toBe(true);
    expect(isOrgAdmin("org.member,org.admin")).toBe(true);
    expect(isOrgAdmin(ORG_ROLE.member)).toBe(false);
    expect(isOrgAdmin("admin")).toBe(false);
    expect(isOrgAdmin(undefined)).toBe(false);
  });
  it("exposes a SQL pattern that matches the same roles", () => {
    const re = new RegExp(ORG_ADMIN_ROLE_SQL_PATTERN);
    expect(re.test("org.admin")).toBe(true);
    expect(re.test("org.member,org.admin")).toBe(true);
    expect(re.test("org.member")).toBe(false);
    expect(re.test("orgXadmin")).toBe(false);
  });
});
