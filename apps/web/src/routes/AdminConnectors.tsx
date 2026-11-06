import type { AdminConnector } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ProviderLogo } from "../components/ProviderLogo.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { CopyField } from "../components/ui/copy-field.tsx";
import { Input } from "../components/ui/input.tsx";
import { useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";

function AppCard({ app }: { app: AdminConnector }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(app.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [clearing, setClearing] = useState(false);
  const [saved, setSaved] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  const save = useMutation(
    orpc.admin.connectors.setApp.mutationOptions({
      onSuccess: async () => {
        setSecret("");
        setSaved(true);
        await refresh();
      },
    }),
  );
  const clear = useMutation(
    orpc.admin.connectors.clearApp.mutationOptions({
      onSuccess: async () => {
        setClearing(false);
        setClientId("");
        setSecret("");
        await refresh();
      },
    }),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    save.mutate({ provider: app.provider, clientId, clientSecret: secret });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderLogo provider={app.provider} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{app.name}</h3>
          <p className="text-xs text-muted-foreground">
            {app.configured ? t("connAdmin.configured") : t("connAdmin.notConfigured")} ·{" "}
            {t("connAdmin.people", { count: app.connectionCount })}
          </p>
        </div>
        {app.configured && (
          <Button variant="ghost" onClick={() => setClearing(true)}>
            <Trash2 className="size-4" /> {t("connAdmin.clear")}
          </Button>
        )}
      </div>

      {!app.vaultReady && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("connAdmin.vaultMissing")}
        </p>
      )}

      <p className="text-sm text-muted-foreground">{t("connAdmin.asanaSteps")}</p>

      <div className="space-y-1">
        <p className="text-sm font-medium">{t("connAdmin.redirect")}</p>
        <CopyField value={app.redirectUri} />
        <p className="text-xs text-muted-foreground">{t("connAdmin.redirectHelp")}</p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1 text-sm">
          <label htmlFor={`${app.provider}-client-id`} className="block font-medium">
            {t("connAdmin.clientId")}
          </label>
          <Input
            id={`${app.provider}-client-id`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor={`${app.provider}-client-secret`} className="block font-medium">
            {t("connAdmin.clientSecret")}
          </label>
          <Input
            id={`${app.provider}-client-secret`}
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            // Required only the first time: an empty field keeps the stored secret.
            required={!app.configured}
          />
          <span className="block text-xs text-muted-foreground">
            {app.configured ? t("connAdmin.secretStored") : t("connAdmin.secretNever")}
          </span>
        </div>
        {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!app.vaultReady || save.isPending || (!secret && !app.configured)}>
            {t("connAdmin.save")}
          </Button>
          {saved && !save.isPending && (
            <span className="text-sm text-muted-foreground">{t("connAdmin.saved")}</span>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={clearing}
        title={t("connAdmin.clearTitle", { name: app.name })}
        description={t("connAdmin.clearBody", { name: app.name })}
        confirmLabel={t("connAdmin.clear")}
        busy={clear.isPending}
        onCancel={() => setClearing(false)}
        onConfirm={() => clear.mutate({ provider: app.provider })}
      />
    </section>
  );
}

export function ConnectorsTab() {
  const t = useT();
  const { data: apps = [] } = useQuery(orpc.admin.connectors.list.queryOptions());
  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-semibold">{t("connAdmin.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("connAdmin.desc")}</p>
      </div>
      <div className="space-y-4">
        {apps.map((app) => (
          // Keyed by stored client ID so the form resets after the credentials change.
          <AppCard key={`${app.provider}:${app.clientId ?? ""}`} app={app} />
        ))}
      </div>
    </div>
  );
}
