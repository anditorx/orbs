import type { Contract } from "@orbs/protocol";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { getLang, LANG_HEADER } from "../i18n/index.ts";

const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  // Server messages follow the language chosen in Settings.
  headers: () => ({ [LANG_HEADER]: getLang() }),
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const rpc: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(rpc);
