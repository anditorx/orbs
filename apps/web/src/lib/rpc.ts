import type { Contract } from "@orbs/protocol";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const rpc: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(rpc);
