import type { TurnState } from "@orbs/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "./rpc.ts";

/** The reply being written for one conversation: where it stands and the text so far (not yet stored). */
/** One use of a connected app while the reply is being written. */
export interface LiveTool {
  app: string;
  tool: string;
  status: "running" | "done" | "failed";
}

export interface LiveTurn {
  state: TurnState | null;
  text: string;
  tools: LiveTool[];
  /** Marks a reply as started right after sending, before the server's first update arrives. */
  begin: (turnId: string) => void;
}

const ended = (s: TurnState | null) =>
  s?.status === "completed" || s?.status === "failed" || s?.status === "cancelled";

/**
 * Follows the live stream of a conversation. The final answer arrives as a normal event; this only covers the
 * moments before that, so the screen can show text as it is written.
 */
export function useTurn(threadId: string): LiveTurn {
  const [state, setState] = useState<TurnState | null>(null);
  const [text, setText] = useState("");
  const [tools, setTools] = useState<LiveTool[]>([]);
  const lastN = useRef(-1);
  const turnRef = useRef<string | null>(null);

  const begin = useCallback((turnId: string) => {
    if (turnRef.current !== turnId) {
      turnRef.current = turnId;
      lastN.current = -1;
      setText("");
      setTools([]);
    }
    setState((prev) =>
      prev?.turnId === turnId && prev.status !== "queued"
        ? prev
        : { turnId, status: "queued", provider: null, modelId: null, errorCode: null },
    );
  }, []);

  // `threadId` is the dependency on purpose: another conversation starts from nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the conversation changes
  useEffect(() => {
    setState(null);
    setText("");
    setTools([]);
    turnRef.current = null;
    lastN.current = -1;
  }, [threadId]);

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const stream = await rpc.turns.watch({ threadId }, { signal: controller.signal });
        for await (const item of stream) {
          if (item.type === "status") {
            const s = item.state;
            if (turnRef.current !== s.turnId) {
              turnRef.current = s.turnId;
              lastN.current = -1;
              setText("");
              setTools([]);
            }
            setState(s);
          } else if (item.type === "tool") {
            if (item.turnId !== turnRef.current && turnRef.current !== null) continue;
            setTools((prev) => {
              if (item.status === "running")
                return [...prev, { app: item.app, tool: item.tool, status: "running" }];
              // The matching request finishes; an answer without a request shown (a late join) still appears.
              const at = prev.findIndex((x) => x.status === "running" && x.tool === item.tool);
              if (at < 0) return [...prev, { app: item.app, tool: item.tool, status: item.status }];
              return prev.map((x, i) => (i === at ? { ...x, status: item.status } : x));
            });
          } else if (item.turnId === turnRef.current || turnRef.current === null) {
            // Pieces can arrive twice after a reconnect; take each once, in order.
            if (item.n <= lastN.current) continue;
            turnRef.current = item.turnId;
            lastN.current = item.n;
            setText((prev) => prev + item.text);
          }
        }
      } catch {
        // Network drop or server restart: reconnect unless we left the conversation.
      }
      if (!controller.signal.aborted) retry = setTimeout(run, 2000);
    };
    void run();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, [threadId]);

  // Once a reply has ended its stored message takes over; don't keep a stale copy on screen.
  useEffect(() => {
    if (!ended(state)) return;
    const timer = setTimeout(() => {
      setState(null);
      setText("");
      setTools([]);
    }, 4000);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, text, tools, begin };
}
