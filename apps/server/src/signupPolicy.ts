/**
 * Who may create an account on this Orbs instance.
 * - open:        anyone who can reach the server (convenient for local development)
 * - invite-only: only through an invitation link whose pending invitation matches the email
 * - domain:      only emails whose domain is in ORBS_SIGNUP_DOMAINS
 * The very first account is always allowed so a fresh install can be bootstrapped.
 */
import { t } from "./i18n.ts";

export type SignupMode = "open" | "invite-only" | "domain";

export interface SignupCheck {
  mode: SignupMode;
  allowedDomains: readonly string[];
  email: string;
  isFirstUser: boolean;
  hasPendingInvite: boolean;
}

export type SignupDecision = { allowed: true } | { allowed: false; reason: string };

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

export function parseDomains(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function decideSignup(check: SignupCheck): SignupDecision {
  if (check.isFirstUser || check.mode === "open") return { allowed: true };
  if (check.mode === "invite-only") {
    return check.hasPendingInvite
      ? { allowed: true }
      : {
          allowed: false,
          reason: t("signup.inviteOnly"),
        };
  }
  const domain = emailDomain(check.email);
  return domain && check.allowedDomains.includes(domain)
    ? { allowed: true }
    : { allowed: false, reason: t("signup.domain") };
}
