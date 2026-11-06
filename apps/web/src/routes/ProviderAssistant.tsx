import {
  emptyProviderChat,
  type ModelProviderStatus,
  type ProviderChatAsk,
  type ProviderChatState,
  redactKey,
  replyToProviderChat,
} from "@orbs/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { type MessageKey, useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";

interface Message {
  id: number;
  from: "assistant" | "user";
  text: string;
}

const ASK_KEY = {
  provider: "pa.ask.provider",
  unknownProvider: "pa.ask.unknownProvider",
  key: "pa.ask.key",
  noKey: "pa.ask.noKey",
  placeholderKey: "pa.ask.placeholderKey",
  labels: "pa.ask.labels",
  ready: "pa.ask.ready",
} as const satisfies Record<ProviderChatAsk, MessageKey>;

/**
 * A short conversation that sets a provider up. The person writes what they want (a suggestion is ready to send),
 * and the assistant asks only for what is still missing: which provider, the API key, optional labels.
 * The key is hidden in the transcript and goes straight to the server, which stores it encrypted.
 */
export function ProviderAssistant({
  providers,
  fixed,
  onConnected,
  onClose,
}: {
  providers: ModelProviderStatus[];
  /** Replace this provider's credentials instead of adding a new provider. */
  fixed?: ModelProviderStatus;
  onConnected: (provider: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const supported = providers.map((p) => p.providerName).join(", ");
  const nameOf = (id: string | undefined) => providers.find((p) => p.provider === id)?.providerName ?? "";
  const suggestion = t("pa.suggestion");

  const seq = useRef(0);
  const say = (from: Message["from"], text: string): Message => ({ id: ++seq.current, from, text });
  const [chat, setChat] = useState<ProviderChatState>(() =>
    fixed ? { ...emptyProviderChat(fixed.provider), awaiting: "key" } : emptyProviderChat(),
  );
  const [messages, setMessages] = useState<Message[]>(() =>
    fixed
      ? [say("assistant", t("pa.ask.key", { provider: fixed.providerName }))]
      : [say("assistant", t("pa.greeting"))],
  );
  const [input, setInput] = useState(fixed ? "" : suggestion);
  const [edited, setEdited] = useState(false);
  const [phase, setPhase] = useState<"chatting" | "connecting" | "connected">("chatting");
  const bottom = useRef<HTMLDivElement>(null);

  // Until the person types, the suggestion follows the active language.
  useEffect(() => {
    if (!fixed && !edited) setInput(suggestion);
  }, [suggestion, edited, fixed]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const connect = useMutation(
    orpc.admin.providers.save.mutationOptions({
      onSuccess: async (status, vars) => {
        await queryClient.invalidateQueries({ queryKey: orpc.admin.providers.key() });
        if (status.status === "connected") {
          setMessages((m) => [
            ...m,
            say(
              "assistant",
              t("pa.connected", {
                provider: status.providerName,
                name: status.name ? ` (${status.name})` : "",
              }),
            ),
            // The key says nothing about the plan it belongs to, so the administrator has to say it.
            ...(status.billingConfirmed ? [] : [say("assistant", t("pa.billingHint"))]),
          ]);
          setPhase("connected");
          onConnected(status.provider);
        } else {
          setMessages((m) => [
            ...m,
            say(
              "assistant",
              t("pa.failed", { provider: status.providerName, error: status.lastError ?? "" }),
            ),
          ]);
          // The key was refused, so ask for another one; the rest of the answers are kept.
          setChat((c) => ({ ...c, apiKey: undefined, awaiting: "key" }));
          setPhase("chatting");
        }
        void vars;
      },
      onError: (e: Error) => {
        setMessages((m) => [...m, say("assistant", e.message)]);
        setChat((c) => ({ ...c, apiKey: undefined, awaiting: "key" }));
        setPhase("chatting");
      },
    }),
  );

  function send() {
    const text = input.trim();
    if (!text || phase !== "chatting") return;
    const result = replyToProviderChat(
      chat,
      text,
      providers.map((p) => ({ id: p.provider, name: p.providerName })),
    );
    const shown = redactKey(text, result.state.apiKey ?? chat.apiKey);
    const reply = say(
      "assistant",
      t(ASK_KEY[result.ask], { provider: nameOf(result.state.provider), supported }),
    );
    setMessages((m) => [...m, say("user", shown), reply]);
    setChat(result.state);
    setInput("");
    setEdited(true);
    if (result.ask === "ready" && result.state.provider && result.state.apiKey) {
      setPhase("connecting");
      connect.mutate({
        provider: result.state.provider,
        name: result.state.name,
        apiKey: result.state.apiKey,
        projectName: result.state.projectName,
        projectNumber: result.state.projectNumber,
      });
    }
  }

  return (
    <div className="flex h-[28rem] flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.from === "user" ? "justify-end" : "justify-start")}>
            <p
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                m.from === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground ring-1 ring-border",
              )}
            >
              {m.text}
            </p>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {phase === "connected" ? (
        <div className="flex justify-end">
          <Button onClick={onClose}>{t("pa.done")}</Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => {
                setEdited(true);
                setInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              aria-label={t("pa.inputLabel")}
              disabled={phase === "connecting"}
              className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-card p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
            <Button onClick={send} disabled={!input.trim() || phase === "connecting"}>
              {phase === "connecting" ? t("pa.connecting") : t("pa.send")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("pa.hint")} · {t("pa.privacy")}
          </p>
        </div>
      )}
    </div>
  );
}
