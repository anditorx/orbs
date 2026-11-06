import { useQuery } from "@tanstack/react-query";
import { orpc } from "./rpc.ts";

/** What each provider and model cost this month across all organizations (system administrators only). */
export function useSystemModelUsage() {
  const { data } = useQuery({ ...orpc.admin.modelUsage.queryOptions({ input: {} }), staleTime: 30_000 });
  return {
    provider: (id: string) => data?.byProvider.find((p) => p.provider === id),
    model: (provider: string, modelId: string) =>
      data?.byModel.find((m) => m.provider === provider && m.modelId === modelId),
  };
}
