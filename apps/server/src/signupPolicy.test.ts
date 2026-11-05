import { describe, expect, it } from "vitest";
import { decideSignup, emailDomain, parseDomains } from "./signupPolicy.ts";

const base = {
  allowedDomains: [] as string[],
  email: "a@corp.co.id",
  isFirstUser: false,
  hasPendingInvite: false,
};

describe("decideSignup", () => {
  it("always allows the first account (bootstrap)", () => {
    expect(decideSignup({ ...base, mode: "invite-only", isFirstUser: true }).allowed).toBe(true);
  });

  it("allows anyone in open mode", () => {
    expect(decideSignup({ ...base, mode: "open" }).allowed).toBe(true);
  });

  it("requires a pending invitation in invite-only mode", () => {
    expect(decideSignup({ ...base, mode: "invite-only" }).allowed).toBe(false);
    expect(decideSignup({ ...base, mode: "invite-only", hasPendingInvite: true }).allowed).toBe(true);
  });

  it("matches the email domain case-insensitively in domain mode", () => {
    const check = {
      ...base,
      mode: "domain" as const,
      allowedDomains: parseDomains(" @Corp.co.id, other.com"),
    };
    expect(decideSignup({ ...check, email: "Budi@CORP.co.id" }).allowed).toBe(true);
    expect(decideSignup({ ...check, email: "budi@gmail.com" }).allowed).toBe(false);
    expect(decideSignup({ ...check, email: "not-an-email" }).allowed).toBe(false);
  });
});

describe("emailDomain", () => {
  it("uses the part after the last @", () => {
    expect(emailDomain("a@b@Example.COM")).toBe("example.com");
  });
});
