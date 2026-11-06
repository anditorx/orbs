import { admin } from "./messages/admin.ts";
import { auth } from "./messages/auth.ts";
import { code } from "./messages/code.ts";
import { common } from "./messages/common.ts";
import { connections } from "./messages/connections.ts";
import { customize } from "./messages/customize.ts";
import { models } from "./messages/models.ts";
import { providers } from "./messages/providers.ts";
import { settings } from "./messages/settings.ts";
import { shell } from "./messages/shell.ts";
import { thread } from "./messages/thread.ts";
import { usage } from "./messages/usage.ts";

export const messages = {
  en: {
    ...common.en,
    ...shell.en,
    ...auth.en,
    ...settings.en,
    ...usage.en,
    ...admin.en,
    ...customize.en,
    ...thread.en,
    ...code.en,
    ...models.en,
    ...providers.en,
    ...connections.en,
  },
  id: {
    ...common.id,
    ...shell.id,
    ...auth.id,
    ...settings.id,
    ...usage.id,
    ...admin.id,
    ...customize.id,
    ...thread.id,
    ...code.id,
    ...models.id,
    ...providers.id,
    ...connections.id,
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];
