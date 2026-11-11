import type { OrbsEvent } from "@orbs/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { orpc, rpc } from "./rpc.ts";

/**
 * One live subscription per app shell. New events are merged into the cached
 * per-thread event lists and refresh the thread list, so every view updates in real time.
 */
export function useLiveEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Read the latest path inside the long-lived subscription without resubscribing.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = (event: OrbsEvent) => {
      if (event.type === "thread.deleted") {
        const threadId = String(event.payload.threadId ?? "");
        queryClient.removeQueries({
          queryKey: orpc.events.list.queryKey({
            input: { streamType: "thread", streamId: threadId, afterSeq: 0 },
          }),
        });
        void queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
        if (pathRef.current === `/t/${threadId}`) void navigate({ to: "/" });
        return;
      }
      if (event.streamType === "org") {
        // Renames, new projects, ... from teammates: refresh the lists that show them.
        void queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
        return;
      }
      if (event.streamType !== "thread") return;
      if (event.type === "artifact.saved")
        void queryClient.invalidateQueries({ queryKey: orpc.artifacts.key() });
      const key = orpc.events.list.queryKey({
        input: { streamType: "thread", streamId: event.streamId, afterSeq: 0 },
      });
      queryClient.setQueryData<OrbsEvent[]>(key, (prev) =>
        prev && !prev.some((e) => e.seq === event.seq) ? [...prev, event] : prev,
      );
      void queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
    };

    const run = async () => {
      try {
        const stream = await rpc.events.subscribe({}, { signal: controller.signal });
        for await (const event of stream) apply(event);
      } catch {
        // Network drop or server restart: reconnect unless the shell unmounted.
      }
      if (!controller.signal.aborted) retryTimer = setTimeout(run, 2000);
    };
    void run();

    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, queryClient, navigate]);
}
