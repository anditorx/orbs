import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareText, Server } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { Dialog } from "../components/ui/dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { SecretInput } from "../components/ui/secret-input.tsx";
import { Tabs } from "../components/ui/tabs.tsx";
import { useT } from "../i18n/index.ts";
import { orpc, rpc } from "../lib/rpc.ts";

function ServerForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const add = useMutation(
    orpc.connections.custom.add.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.connections.custom.key() });
        onDone();
      },
    }),
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate({ name, url, token: token || undefined });
  }
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("custom.desc")}</p>
      <div className="space-y-1.5">
        <label htmlFor="custom-name" className="block text-sm font-medium">
          {t("custom.name")}
        </label>
        <Input
          id="custom-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="custom-url" className="block text-sm font-medium">
          {t("custom.url")}
        </label>
        <Input
          id="custom-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/mcp"
          spellCheck={false}
          required
        />
        <p className="text-xs text-muted-foreground">{t("custom.urlHelp")}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="custom-token" className="block text-sm font-medium">
          {t("custom.token")}
        </label>
        <SecretInput id="custom-token" value={token} onChange={(e) => setToken(e.target.value)} />
        <p className="text-xs text-muted-foreground">{t("custom.tokenHelp")}</p>
      </div>
      {add.error && <p className="text-sm text-destructive">{add.error.message}</p>}
      <div className="mt-auto flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          {t("conn.add.cancel")}
        </Button>
        <Button type="submit" disabled={add.isPending || !name.trim() || !url.trim()}>
          {add.isPending ? t("custom.adding") : t("custom.save")}
        </Button>
      </div>
    </form>
  );
}

/** Starts a conversation from a prompt, for connections Orbs has no built-in support for. */
function PromptForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const suggestion = t("conn.add.suggestion");
  const [text, setText] = useState(suggestion);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Until the person types, the suggestion follows the active language.
  useEffect(() => {
    if (!edited) setText(suggestion);
  }, [suggestion, edited]);

  const start = useMutation({
    mutationFn: async () => {
      const thread = await rpc.threads.create({
        title: t("conn.add.threadTitle"),
        mode: "work",
        engine: { kind: "auto" },
      });
      await rpc.threads.postMessage({ threadId: thread.id, text });
      return thread;
    },
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
      onDone();
      await navigate({ to: "/t/$threadId", params: { threadId: thread.id } });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      className="flex flex-1 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">{t("conn.add.desc")}</p>
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="add-mcp-prompt" className="block text-sm font-medium">
          {t("conn.add.label")}
        </label>
        <textarea
          id="add-mcp-prompt"
          value={text}
          onChange={(e) => {
            setEdited(true);
            setText(e.target.value);
          }}
          maxLength={20_000}
          className="min-h-32 w-full flex-1 resize-none rounded-lg border border-border bg-card p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p className="text-xs text-muted-foreground">{t("conn.add.warning")}</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="mt-auto flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          {t("conn.add.cancel")}
        </Button>
        <Button type="submit" disabled={!text.trim() || start.isPending}>
          {start.isPending ? t("conn.add.sending") : t("conn.add.send")}
        </Button>
      </div>
    </form>
  );
}

/** The one entry point for adding something new: a dialog with two ways to do it. */
export function AddConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  // The prompt comes first and is what opens by default, every time.
  const [tab, setTab] = useState<"prompt" | "server">("prompt");
  useEffect(() => {
    if (open) setTab("prompt");
  }, [open]);
  const tabs = [
    { id: "prompt", label: t("conn.add.tab.prompt"), icon: MessageSquareText },
    { id: "server", label: t("conn.add.tab.server"), icon: Server },
  ] as const;
  return (
    <Dialog open={open} title={t("conn.addConnection")} onClose={onClose}>
      <div className="mb-5">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>
      {/* Same height for both tabs, so the window doesn't jump when switching. */}
      <div className="flex h-[26rem] flex-col">
        {tab === "prompt" ? <PromptForm onDone={onClose} /> : <ServerForm onDone={onClose} />}
      </div>
    </Dialog>
  );
}
