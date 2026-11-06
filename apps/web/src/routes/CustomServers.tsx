import type { CustomMcpServer, CustomMcpTool } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "../components/ProviderLogo.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { useLocale, useT } from "../i18n/index.ts";
import { orpc, rpc } from "../lib/rpc.ts";
import { ConnectionRow } from "./ConnectionRow.tsx";
import { ToolRunner } from "./ToolRunner.tsx";

function Tools({ server }: { server: CustomMcpServer }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const key = orpc.connections.custom.tools.queryOptions({ input: { id: server.id } });
  const { data, isLoading, error } = useQuery({ ...key, enabled: open, staleTime: 30_000, retry: false });
  const toggle = useMutation(
    orpc.connections.custom.setAllowed.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.connections.custom.key() });
      },
    }),
  );
  const allowedNames = data?.filter((x) => x.allowed).map((x) => x.name) ?? [];
  const change = (name: string, on: boolean) =>
    toggle.mutate({
      id: server.id,
      tools: on ? [...allowedNames, name] : allowedNames.filter((n) => n !== name),
    });
  const hint = (tool: CustomMcpTool) =>
    tool.destructiveHint
      ? t("custom.hint.destructive")
      : tool.readOnlyHint
        ? t("custom.hint.readOnly")
        : t("custom.hint.unknown");

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {open ? t("conn.toolsHide") : t("conn.toolsShow")}
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("custom.toolsDesc")}</p>
          {isLoading && <p className="text-sm text-muted-foreground">{t("conn.toolsLoading")}</p>}
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          {toggle.error && <p className="text-sm text-destructive">{toggle.error.message}</p>}
          <ul className="space-y-1">
            {data?.map((tool) => (
              <li
                key={tool.name}
                className="rounded-lg border border-border px-3 py-2"
                title={tool.description}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id={`allow-${server.id}-${tool.name}`}
                    checked={tool.allowed}
                    disabled={toggle.isPending}
                    onChange={(e) => change(tool.name, e.target.checked)}
                    className="mt-1"
                  />
                  <label
                    htmlFor={`allow-${server.id}-${tool.name}`}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <p className="truncate font-mono text-xs">{tool.name}</p>
                    <p className="text-[11px] text-muted-foreground">{hint(tool)}</p>
                  </label>
                  {tool.allowed && (
                    <button
                      type="button"
                      onClick={() => setPicked(tool.name)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t("custom.try")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {picked && data?.some((x) => x.name === picked && x.allowed) && (
            <ToolRunner
              tool={data.find((x) => x.name === picked) ?? null}
              call={(tool, args) => rpc.connections.custom.call({ id: server.id, tool, args })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ServerRow({ server }: { server: CustomMcpServer }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation(
    orpc.connections.custom.remove.mutationOptions({
      onSuccess: async () => {
        setConfirming(false);
        await queryClient.invalidateQueries({ queryKey: orpc.connections.custom.key() });
      },
    }),
  );
  const date = (v: string) => new Date(v).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <ConnectionRow
      logo={<ProviderLogo provider="custom" />}
      title={server.name}
      subtitle={`${server.host} · ${t("custom.allowedCount", { count: server.allowedTools.length })}`}
      status={server.hasToken ? t("custom.withToken") : t("custom.noToken")}
      tone="idle"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <p className="text-xs text-muted-foreground">
        {t("conn.connectedAt", { date: date(server.createdAt) })} ·{" "}
        {server.lastUsedAt ? t("conn.lastUsed", { date: date(server.lastUsedAt) }) : t("conn.neverUsed")}
      </p>
      <Tools server={server} />
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" /> {t("custom.remove")}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t("custom.removeTitle", { name: server.name })}
        description={t("custom.removeBody")}
        confirmLabel={t("custom.remove")}
        busy={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate({ id: server.id })}
      />
    </ConnectionRow>
  );
}

/** The person's own servers, as rows in the same list as the built-in services. */
export function CustomServers() {
  const { data = [] } = useQuery(orpc.connections.custom.list.queryOptions());
  return (
    <>
      {data.map((server) => (
        <ServerRow key={server.id} server={server} />
      ))}
    </>
  );
}
