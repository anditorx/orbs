import type { AdminModel, ModelProviderStatus, ProviderDiagnostics } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MinusCircle, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "../components/ProviderLogo.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Dialog } from "../components/ui/dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { useLocale, useT } from "../i18n/index.ts";
import { useSystemModelUsage } from "../lib/modelUsage.ts";
import { idr, num, usd } from "../lib/money.ts";
import { orpc, rpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";
import { ConnectionRow, type Tone } from "./ConnectionRow.tsx";
import { ProviderAssistant } from "./ProviderAssistant.tsx";

function EndpointList({ diag }: { diag: ProviderDiagnostics }) {
  const t = useT();
  const ok = diag.endpoints.filter((e) => e.status === "ok").length;
  const failed = diag.endpoints.filter((e) => e.status === "failed").length;
  const skipped = diag.endpoints.length - ok - failed;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">
        {t("prov.endpoints.title")}{" "}
        <span className={cn("font-normal", failed ? "text-amber-700" : "text-muted-foreground")}>
          {t("prov.endpoints.summary", { ok, total: diag.endpoints.length })}
          {failed > 0 && ` · ${t("prov.endpoints.failed", { count: failed })}`}
          {skipped > 0 && ` · ${t("prov.endpoints.skipped", { count: skipped })}`}
        </span>
      </h4>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {diag.endpoints.map((e) => (
          <li key={e.id} className="flex items-start gap-3 px-3 py-2 text-sm">
            {e.status === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : e.status === "failed" ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{e.label}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {e.method} {e.path}
              </p>
              {e.detail && <p className="text-xs text-muted-foreground">{e.detail}</p>}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {e.httpStatus ?? ""}
              {e.ms !== null && ` · ${e.ms} ms`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Every model the connected key offers, each with the two settings that matter:
 * Active = it appears in the model lists; Enabled = it can be chosen (off = shown greyed out).
 */
function ModelList({ provider, registry }: { provider: string; registry: AdminModel[] }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: offered = [], isLoading } = useQuery({
    ...orpc.admin.providers.models.queryOptions({ input: { provider } }),
    staleTime: 60_000,
  });
  const set = useMutation({
    mutationFn: (v: { modelId: string; listed?: boolean; enabled?: boolean }) =>
      rpc.admin.providers.setModel({ provider, ...v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() }),
    onError: (e: Error) => setError(e.message),
  });

  const state = new Map(registry.filter((m) => m.provider === provider).map((m) => [m.modelId, m]));
  const rows = offered.map((m) => {
    const id = m.name.replace(/^models\//, "");
    const reg = state.get(id);
    return {
      m,
      id,
      listed: reg?.listed ?? false,
      enabled: (reg?.listed ?? false) && (reg?.active ?? false),
      refused: m.usable === false,
    };
  });
  const activeCount = rows.filter((r) => r.listed).length;
  const q = filter.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (!onlyActive || r.listed) && (!q || `${r.id} ${r.m.displayName}`.toLowerCase().includes(q)),
  );
  const num = (n: number | null) => (n === null ? "—" : n.toLocaleString(locale));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          {t("prov.models.title")}{" "}
          <span className="font-normal text-muted-foreground">
            {t("prov.models.count", { active: activeCount, total: rows.length })}
          </span>
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={onlyActive}
            onClick={() => setOnlyActive((v) => !v)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs",
              onlyActive
                ? "border-primary bg-accent text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t("prov.models.onlyActive")}
          </button>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("prov.models.filter")}
            aria-label={t("prov.models.filter")}
            className="h-8 w-44 text-xs"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("prov.models.legend")}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-end gap-6 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <span className="w-16 text-center">{t("prov.models.colActive")}</span>
          <span className="w-16 text-center">{t("prov.models.colEnabled")}</span>
        </div>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {isLoading && (
            <li className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("prov.models.loading")}
            </li>
          )}
          {shown.map(({ m, id, listed, enabled, refused }) => (
            <li key={m.name} className="flex items-center gap-4 px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium">{m.displayName}</span>
                  <span className="font-mono text-xs text-muted-foreground">{id}</span>
                </div>
                {refused && <p className="text-xs text-amber-700">{t("prov.models.refused")}</p>}
                <p className="text-xs text-muted-foreground">
                  {t("prov.models.limits", {
                    input: num(m.inputTokenLimit),
                    output: num(m.outputTokenLimit),
                  })}
                  {m.methods.length > 0 && ` · ${m.methods.join(", ")}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-6">
                <span className="flex w-16 justify-center">
                  <Switch
                    checked={listed}
                    disabled={set.isPending}
                    label={t("prov.models.colActive")}
                    onChange={(next) => {
                      setError(null);
                      set.mutate({ modelId: id, listed: next });
                    }}
                  />
                </span>
                <span className="flex w-16 justify-center">
                  <Switch
                    checked={enabled}
                    disabled={!listed || refused || set.isPending}
                    label={t("prov.models.colEnabled")}
                    onChange={(next) => {
                      setError(null);
                      set.mutate({ modelId: id, enabled: next });
                    }}
                  />
                </span>
              </div>
            </li>
          ))}
          {!isLoading && shown.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">{t("prov.models.empty")}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** While a provider isn't connected its models stay, dimmed: their settings are kept and nothing is deleted. */
function KeptModels({ item, registry }: { item: ModelProviderStatus; registry: AdminModel[] }) {
  const t = useT();
  const kept = registry.filter((m) => m.provider === item.provider);
  if (kept.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-amber-700">{t("prov.models.disconnected", { name: item.providerName })}</p>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card opacity-60">
        {kept.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="font-medium">{m.displayName}</span>
            <span className="font-mono text-xs text-muted-foreground">{m.modelId}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderRow({
  item,
  providers,
  registry,
  defaultOpen,
}: {
  item: ModelProviderStatus;
  providers: ModelProviderStatus[];
  registry: AdminModel[];
  defaultOpen: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });

  const diagnose = useMutation(orpc.admin.providers.diagnose.mutationOptions());
  const test = useMutation(
    orpc.admin.providers.test.mutationOptions({
      onSuccess: async (status) => {
        setNote(
          status.status === "connected"
            ? { text: t("prov.testOk"), ok: true }
            : { text: t("prov.testFailed", { error: status.lastError ?? "" }), ok: false },
        );
        await refresh();
      },
      onError: async (e: Error) => {
        setNote({ text: t("prov.testFailed", { error: e.message }), ok: false });
        await refresh();
      },
    }),
  );
  const billing = useMutation(
    orpc.admin.providers.setBilling.mutationOptions({
      onSuccess: () => refresh(),
    }),
  );
  const remove = useMutation(
    orpc.admin.providers.remove.mutationOptions({
      onSuccess: async () => {
        setConfirming(false);
        await refresh();
      },
    }),
  );

  const connected = item.status === "connected";
  const status: { label: string; tone: Tone } = connected
    ? { label: t("prov.status.connected"), tone: "ok" }
    : { label: t("prov.status.failed"), tone: "warn" };
  const checked = item.lastCheckedAt
    ? t("prov.checked", {
        date: new Date(item.lastCheckedAt).toLocaleString(locale, {
          dateStyle: "medium",
          timeStyle: "medium",
        }),
      })
    : undefined;
  const project = [item.projectName, item.projectNumber].filter(Boolean).join(" · ");
  const used = useSystemModelUsage().provider(item.provider);

  return (
    <ConnectionRow
      logo={<ProviderLogo provider={item.provider} />}
      title={item.providerName}
      subtitle={[item.name, item.keyHint ? `…${item.keyHint}` : null, project || null]
        .filter(Boolean)
        .join(" · ")}
      status={status.label}
      tone={status.tone}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <p className="text-sm text-muted-foreground">
        {used && used.totalTokens > 0
          ? t("prov.usageMonth", {
              usd: usd(used.costMicroUsd),
              idr: idr(used.costIdr),
              tokens: num(used.totalTokens),
              people: used.people,
            })
          : t("prov.usageNone")}
      </p>
      {item.status === "failed" && item.lastError && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700">{item.lastError}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setNote(null);
            test.mutate({ provider: item.provider });
          }}
          disabled={test.isPending}
        >
          {test.isPending ? t("prov.testing") : t("prov.test")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setNote(null);
            diagnose.mutate({ provider: item.provider });
          }}
          disabled={diagnose.isPending || !connected}
        >
          {diagnose.isPending ? t("prov.diagnosing") : t("prov.diagnose")}
        </Button>
        {!replacing && (
          <Button variant="ghost" onClick={() => setReplacing(true)}>
            {t("prov.replace")}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" /> {t("prov.remove")}
        </Button>
        {checked && <span className="text-xs text-muted-foreground">{checked}</span>}
      </div>
      {note && <p className={note.ok ? "text-sm text-emerald-600" : "text-sm text-amber-700"}>{note.text}</p>}
      {(diagnose.error || test.error || remove.error || billing.error) && (
        <p className="text-sm text-destructive">
          {(diagnose.error ?? test.error ?? remove.error ?? billing.error)?.message}
        </p>
      )}

      <Dialog open={replacing} title={t("prov.replace")} onClose={() => setReplacing(false)}>
        <ProviderAssistant
          providers={providers}
          fixed={item}
          onConnected={() => undefined}
          onClose={() => setReplacing(false)}
        />
      </Dialog>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
        <Switch
          checked={item.billingConfirmed}
          disabled={billing.isPending}
          label={t("prov.billing.label")}
          onChange={(confirmed) => billing.mutate({ provider: item.provider, confirmed })}
        />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{t("prov.billing.label")}</p>
          <p className="text-xs text-muted-foreground">{t("prov.billing.help")}</p>
          {!item.billingConfirmed && <p className="text-xs text-amber-700">{t("prov.billing.needed")}</p>}
        </div>
      </div>

      {connected ? (
        <ModelList provider={item.provider} registry={registry} />
      ) : (
        <KeptModels item={item} registry={registry} />
      )}

      {diagnose.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("prov.diagnosing")}
        </p>
      )}
      {diagnose.data && connected && <EndpointList diag={diagnose.data} />}

      <ConfirmDialog
        open={confirming}
        title={t("prov.removeTitle", { name: item.providerName })}
        description={
          item.modelCount > 0
            ? t(item.modelCount === 1 ? "prov.removeBodyOne" : "prov.removeBodyModels", {
                count: item.modelCount,
                name: item.providerName,
              })
            : t("prov.removeBody")
        }
        confirmLabel={t("prov.remove")}
        busy={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate({ provider: item.provider })}
      />
    </ConnectionRow>
  );
}

export function ProvidersSection() {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // Every load, every 30 seconds and every return to the window re-verifies the keys with the provider, so
  // the badge reflects what is true now rather than what was true when the key was saved.
  const { data, isLoading } = useQuery({
    ...orpc.admin.providers.check.queryOptions(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const { data: registry = [] } = useQuery(orpc.admin.models.list.queryOptions());
  const configured = data?.filter((p) => p.configured) ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("prov.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("prov.desc")}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> {t("prov.add")}
        </Button>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading && (
          <li className="flex items-center gap-4 px-5 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("prov.status.checking")}
          </li>
        )}
        {!isLoading && configured.length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-muted-foreground">{t("prov.empty")}</li>
        )}
        {configured.map((item) => (
          <ProviderRow
            key={item.provider}
            item={item}
            providers={data ?? []}
            registry={registry}
            defaultOpen={item.provider === justAdded}
          />
        ))}
      </ul>
      <Dialog open={adding} title={t("prov.add")} onClose={() => setAdding(false)}>
        <ProviderAssistant
          providers={data ?? []}
          onConnected={(provider) => setJustAdded(provider)}
          onClose={() => setAdding(false)}
        />
      </Dialog>
    </section>
  );
}
