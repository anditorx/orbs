import { organizationClient } from "better-auth/client/plugins";
import { adminAc, memberAc } from "better-auth/plugins/organization/access";
import { createAuthClient } from "better-auth/react";
import { getLang, LANG_HEADER } from "../i18n/index.ts";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    onRequest: (context) => {
      context.headers.set(LANG_HEADER, getLang());
    },
  },
  plugins: [
    organizationClient({
      teams: { enabled: true },
      roles: { "org.admin": adminAc, "org.member": memberAc },
    }),
  ],
});
