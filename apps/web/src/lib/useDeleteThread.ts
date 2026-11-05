import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { orpc } from "./rpc.ts";

/** Deletes a conversation, clears its cached data and leaves its page if it is open. */
export function useDeleteThread() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return useMutation(
    orpc.threads.delete.mutationOptions({
      onSuccess: async (_data, { threadId }) => {
        queryClient.removeQueries({
          queryKey: orpc.events.list.queryKey({
            input: { streamType: "thread", streamId: threadId, afterSeq: 0 },
          }),
        });
        await queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
        if (pathname === `/t/${threadId}`) await navigate({ to: "/" });
      },
    }),
  );
}
