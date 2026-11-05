import { organizationClient } from "better-auth/client/plugins";
import { adminAc, memberAc } from "better-auth/plugins/organization/access";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [
    organizationClient({
      teams: { enabled: true },
      roles: { "org.admin": adminAc, "org.member": memberAc },
    }),
  ],
});
