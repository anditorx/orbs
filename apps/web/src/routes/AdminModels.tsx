import type { AdminModel, AdminModelInput } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { type MessageKey, useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";

const CLASS_LABEL = {
  public: "models.class.public",
  internal: "models.class.internal",
  confidential: "models.class.confidential",
} as const satisfies Record<string, MessageKey>;

interface Draft {
  provider: string;
  modelId: string;
  displayName: string;
  input: string;
  output: string;
  quality: string;
  maxDataClass: AdminModelInput["maxDataClass"];
}

const emptyDraft: Draft = {
  provider: "",
  modelId: "",
  displayName: "",
  input: "",
  output: "",
  quality: "",
  maxDataClass: "internal",
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));

function ModelForm({ editing, onDone }: { editing: AdminModel | null; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(
    editing
      ? {
          provider: editing.provider,
          modelId: editing.modelId,
          displayName: editing.displayName,
          input: editing.inputUsdPerMtok?.toString() ?? "",
          output: editing.outputUsdPerMtok?.toString() ?? "",
          quality: editing.qualityScore?.toString() ?? "",
          maxDataClass: editing.maxDataClass,
        }
      : emptyDraft,
  );
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const onSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
    onDone();
  };
  const create = useMutation(orpc.admin.models.create.mutationOptions({ onSuccess }));
  const update = useMutation(orpc.admin.models.update.mutationOptions({ onSuccess }));
  const error = create.error ?? update.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    const fields = {
      provider: draft.provider,
      modelId: draft.modelId,
      displayName: draft.displayName,
      inputUsdPerMtok: num(draft.input),
      outputUsdPerMtok: num(draft.output),
      qualityScore: num(draft.quality),
      maxDataClass: draft.maxDataClass,
    };
    if (editing) update.mutate({ id: editing.id, patch: fields });
    else create.mutate(fields);
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-2xl border border-primary/40 bg-card p-5 sm:grid-cols-2"
    >
      <h3 className="font-semibold sm:col-span-2">{editing ? t("models.edit") : t("models.add")}</h3>
      <Input
        placeholder={t("models.field.provider")}
        value={draft.provider}
        onChange={(e) => set({ provider: e.target.value })}
        required
      />
      <Input
        placeholder={t("models.field.modelId")}
        value={draft.modelId}
        onChange={(e) => set({ modelId: e.target.value })}
        required
      />
      <Input
        className="sm:col-span-2"
        placeholder={t("models.field.displayName")}
        value={draft.displayName}
        onChange={(e) => set({ displayName: e.target.value })}
        required
      />
      <Input
        type="number"
        min={0}
        step="any"
        placeholder={t("models.field.input")}
        value={draft.input}
        onChange={(e) => set({ input: e.target.value })}
      />
      <Input
        type="number"
        min={0}
        step="any"
        placeholder={t("models.field.output")}
        value={draft.output}
        onChange={(e) => set({ output: e.target.value })}
      />
      <Input
        type="number"
        min={0}
        max={1}
        step="any"
        placeholder={t("models.field.quality")}
        value={draft.quality}
        onChange={(e) => set({ quality: e.target.value })}
      />
      <select
        value={draft.maxDataClass}
        onChange={(e) => set({ maxDataClass: e.target.value as Draft["maxDataClass"] })}
        aria-label={t("models.field.dataClass")}
        className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
      >
        {(Object.keys(CLASS_LABEL) as Array<keyof typeof CLASS_LABEL>).map((c) => (
          <option key={c} value={c}>
            {t("models.field.dataClass")}: {t(CLASS_LABEL[c])}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive sm:col-span-2">{error.message}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function Registry() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: models = [] } = useQuery(orpc.admin.models.list.queryOptions());
  const [form, setForm] = useState<AdminModel | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  const toggle = useMutation(
    orpc.admin.models.update.mutationOptions({
      onSuccess: refresh,
      onError: (e: Error) => setError(e.message),
    }),
  );
  const remove = useMutation(
    orpc.admin.models.delete.mutationOptions({
      onSuccess: async () => {
        setDeleting(null);
        await refresh();
      },
      onError: (e: Error) => setError(e.message),
    }),
  );
  const price = (m: AdminModel) =>
    m.inputUsdPerMtok === null && m.outputUsdPerMtok === null
      ? "—"
      : t("models.price", { input: m.inputUsdPerMtok ?? "—", output: m.outputUsdPerMtok ?? "—" });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("models.registry")}</h2>
          <p className="text-sm text-muted-foreground">{t("models.registryDesc")}</p>
        </div>
        <Button onClick={() => setForm("new")}>
          <Plus className="size-4" /> {t("models.add")}
        </Button>
      </div>
      {form && (
        <ModelForm
          key={form === "new" ? "new" : form.id}
          editing={form === "new" ? null : form}
          onDone={() => setForm(null)}
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t("models.col.model")}</th>
              <th className="px-4 py-3 font-medium">{t("models.col.prices")}</th>
              <th className="px-4 py-3 font-medium">{t("models.col.dataClass")}</th>
              <th className="px-4 py-3 font-medium">{t("models.col.orgs")}</th>
              <th className="px-4 py-3 font-medium">{t("models.col.active")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{m.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.provider} · {m.modelId}
                  </p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{price(m)}</td>
                <td className="px-4 py-3">{t(CLASS_LABEL[m.maxDataClass])}</td>
                <td className="px-4 py-3">{m.orgCount}</td>
                <td className="px-4 py-3">
                  <Switch
                    checked={m.active}
                    label={m.active ? t("models.active") : t("models.inactive")}
                    onChange={(active) => {
                      setError(null);
                      toggle.mutate({ id: m.id, patch: { active } });
                    }}
                  />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={t("customize.editAria", { name: m.displayName })}
                    onClick={() => setForm(m)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("customize.deleteAria", { name: m.displayName })}
                    onClick={() => setDeleting(m)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  {t("models.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title={t("models.deleteTitle")}
        description={t("models.deleteBody", { name: deleting?.displayName ?? "" })}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </section>
  );
}

function PerOrganization() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: orgs = [] } = useQuery(orpc.admin.orgs.list.queryOptions());
  const [orgId, setOrgId] = useState("");
  const selected = orgId || orgs[0]?.id || "";
  const { data: rows = [] } = useQuery({
    ...orpc.admin.models.forOrg.queryOptions({ input: { orgId: selected } }),
    enabled: Boolean(selected),
  });
  const [error, setError] = useState<string | null>(null);
  const set = useMutation(
    orpc.admin.models.setForOrg.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() }),
      onError: (e: Error) => setError(e.message),
    }),
  );
  const change = (modelId: string, assigned: boolean, enabled: boolean) => {
    setError(null);
    set.mutate({ orgId: selected, modelId, assigned, enabled });
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">{t("models.perOrg")}</h2>
        <p className="text-sm text-muted-foreground">{t("models.perOrgDesc")}</p>
      </div>
      {orgs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("models.noOrgs")}
        </p>
      ) : (
        <>
          <select
            value={selected}
            onChange={(e) => setOrgId(e.target.value)}
            aria-label={t("models.pickOrg")}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("models.col.model")}</th>
                  <th className="px-4 py-3 font-medium">{t("models.col.appears")}</th>
                  <th className="px-4 py-3 font-medium">{t("models.col.enabled")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.modelId}
                    className={cn("border-b border-border last:border-0", !r.active && "opacity-70")}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.provider} · {r.model}
                        {!r.active && (
                          <span className="ml-2 text-destructive">{t("models.globalOffNote")}</span>
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={r.assigned}
                        label={t("models.col.appears")}
                        onChange={(assigned) => change(r.modelId, assigned, assigned)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={r.assigned && r.enabled}
                        disabled={!r.assigned}
                        label={t("models.col.enabled")}
                        onChange={(enabled) => change(r.modelId, true, enabled)}
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      {t("models.perOrgEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function ModelsTab() {
  return (
    <div className="space-y-10">
      <Registry />
      <PerOrganization />
    </div>
  );
}
