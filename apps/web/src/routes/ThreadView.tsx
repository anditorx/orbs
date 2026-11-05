import type { Engine, OrbsEvent } from "@orbs/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { FileText, Info, MonitorPlay, PanelRight, SendHorizontal, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { EnginePicker } from "../components/EnginePicker.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { getLang, localeOf, useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { setUi, type UiState, useUi } from "../lib/uiState.ts";
import { useDeleteThread } from "../lib/useDeleteThread.ts";
import { modKey, useShortcuts } from "../lib/useShortcuts.ts";
import { cn } from "../lib/utils.ts";

function EventRow({ event }: { event: OrbsEvent }) {
  const t = useT();
  const time = new Date(event.occurredAt).toLocaleTimeString(localeOf(getLang()), {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (event.type === "message.posted") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          {String(event.payload.text ?? "")}
          <span className="mt-1 block text-right text-[10px] opacity-70">{time}</span>
        </div>
      </div>
    );
  }
  if (event.type === "thread.created") {
    return <p className="text-center text-xs text-muted-foreground">{t("thread.started", { time })}</p>;
  }
  return (
    <p className="text-center text-xs text-muted-foreground">
      {event.type} · {time}
    </p>
  );
}

export function ThreadView() {
  const t = useT();
  const { threadId } = useParams({ from: "/app/t/$threadId" });
  const input = { streamType: "thread", streamId: threadId, afterSeq: 0 };
  const { data: events = [] } = useQuery(orpc.events.list.queryOptions({ input }));
  const { data: threads = [] } = useQuery(orpc.threads.list.queryOptions({ input: { limit: 200 } }));
  const thread = threads.find((th) => th.id === threadId);
  const [engine, setEngine] = useState<Engine>({ kind: "auto" });
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const post = useMutation(orpc.threads.postMessage.mutationOptions());
  const deleteThread = useDeleteThread();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panelOpen = useUi((s) => s.rightPanelOpen);
  const panelTab = useUi((s) => s.rightPanelTab);
  const shortcuts = useMemo(
    () => ({ "mod+i": () => setUi((s) => ({ rightPanelOpen: !s.rightPanelOpen })) }),
    [],
  );
  useShortcuts(shortcuts);

  useEffect(() => {
    if (thread) setEngine(thread.engine);
  }, [thread]);

  const sorted = useMemo(() => [...events].sort((a, b) => a.seq - b.seq), [events]);
  useEffect(() => {
    if (sorted.length > 0) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [sorted.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    post.mutate({ threadId, text: value });
  }

  const messageCount = sorted.filter((e) => e.type === "message.posted").length;
  const tabs: Array<{ id: UiState["rightPanelTab"]; label: string; icon: typeof Info }> = [
    { id: "info", label: t("thread.tab.info"), icon: Info },
    { id: "files", label: t("thread.tab.files"), icon: FileText },
    { id: "preview", label: t("thread.tab.preview"), icon: MonitorPlay },
  ];

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-6">
          <h2 className="truncate text-sm font-semibold">{thread?.title ?? t("thread.fallbackTitle")}</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={t("thread.deleteAria")}
              title={t("thread.deleteAria")}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setUi((s) => ({ rightPanelOpen: !s.rightPanelOpen }))}
              aria-label={t("thread.infoPanel")}
              title={t("thread.infoPanelTitle", { key: modKey })}
              className={cn(
                "rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                panelOpen && "bg-muted text-foreground",
              )}
            >
              <PanelRight className="size-4" />
            </button>
          </div>
        </header>
        <ConfirmDialog
          open={confirmDelete}
          title={t("thread.deleteTitle")}
          description={t("thread.deleteBody")}
          busy={deleteThread.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => deleteThread.mutate({ threadId }, { onSettled: () => setConfirmDelete(false) })}
        />
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-3">
            {sorted.map((event) => (
              <EventRow key={event.seq} event={event} />
            ))}
            {messageCount > 0 && (
              <p className="text-center text-xs text-muted-foreground">{t("thread.noAgent")}</p>
            )}
            <div ref={bottom} />
          </div>
        </div>
        <form onSubmit={submit} className="px-6 pb-5">
          <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-3 shadow-sm focus-within:border-primary">
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) submit(e);
              }}
              placeholder={t("thread.placeholder")}
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-2 flex items-center justify-between">
              <EnginePicker value={engine} onChange={setEngine} />
              <Button type="submit" disabled={!text.trim() || post.isPending} aria-label={t("thread.send")}>
                <SendHorizontal className="size-4" />
              </Button>
            </div>
          </div>
        </form>
      </div>

      {panelOpen && (
        <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-sidebar">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => setUi({ rightPanelTab: id })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm",
                  panelTab === id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setUi({ rightPanelOpen: false })}
              aria-label={t("thread.closePanel")}
              className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
            {panelTab === "info" && thread && (
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("thread.info.title")}</dt>
                  <dd>{thread.title}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("thread.info.mode")}</dt>
                  <dd>{thread.mode === "code" ? t("shell.code") : t("shell.work")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("thread.info.engine")}</dt>
                  <dd>
                    {thread.engine.kind === "auto"
                      ? t("engine.autoName")
                      : thread.engine.kind === "model"
                        ? thread.engine.modelId
                        : thread.engine.harness}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("thread.info.messages")}</dt>
                  <dd>{messageCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("thread.info.created")}</dt>
                  <dd>{new Date(thread.createdAt).toLocaleString(localeOf(getLang()))}</dd>
                </div>
              </dl>
            )}
            {panelTab === "files" && <p className="text-muted-foreground">{t("thread.files")}</p>}
            {panelTab === "preview" && <p className="text-muted-foreground">{t("thread.preview")}</p>}
          </div>
        </aside>
      )}
    </div>
  );
}
