import { type AdminModel, checkPriceFloor, pricingPageFor, referencePriceFor } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { type MessageKey, useLocale, useT } from "../i18n/index.ts";
import { useSystemModelUsage } from "../lib/modelUsage.ts";
import { num as formatNumber, idr, usd } from "../lib/money.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";
import { ProvidersSection } from "./AdminProviders.tsx";

const DATA_ALLOWED = {
  public: "models.dataAllowed.public",
  internal: "models.dataAllowed.internal",
  confidential: "models.dataAllowed.confidential",
} as const satisfies Record<AdminModel["maxDataClass"], MessageKey>;

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** 0.1 -> "0.10", 2.5 -> "2.50": prices read as money, keeping up to four decimals when they need them. */
const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Edits what people and reports see about a model. The provider and model ID are fixed: they identify it. */
function ModelForm({ model, onDone }: { model: AdminModel; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(model.displayName);
  const [input, setInput] = useState(model.inputUsdPerMtok?.toString() ?? "");
  const [output, setOutput] = useState(model.outputUsdPerMtok?.toString() ?? "");
  const [maxDataClass, setMaxDataClass] = useState(model.maxDataClass);
  const [quality, setQuality] = useState(model.qualityScore?.toString() ?? "");
  const update = useMutation(
    orpc.admin.models.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
        onDone();
      },
    }),
  );

  const reference = referencePriceFor(model.provider, model.modelId);
  const pricingPage = reference?.url ?? pricingPageFor(model.provider);
  // Each price is checked on its own: the other one is held at its minimum so only this field can fail.
  const inputLow =
    reference !== undefined &&
    !checkPriceFloor(model.provider, model.modelId, num(input), reference.output).ok;
  const outputLow =
    reference?.output != null &&
    !checkPriceFloor(model.provider, model.modelId, reference.input, num(output)).ok;
  const minText = (n: number) => `$${money(n)}`;
  const locale = useLocale();

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      id: model.id,
      patch: {
        displayName: name,
        inputUsdPerMtok: num(input),
        outputUsdPerMtok: num(output),
        qualityScore: num(quality),
        maxDataClass,
      },
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-primary/40 bg-card p-5">
      <div>
        <h3 className="font-semibold">{t("models.edit", { name: model.displayName })}</h3>
        <p className="font-mono text-xs text-muted-foreground">
          {model.provider} · {model.modelId}
        </p>
      </div>
      <Field id="model-name" label={t("models.form.name")} hint={t("models.form.nameHint")}>
        <Input id="model-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <div className="space-y-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="model-in"
            label={t("models.form.input")}
            hint={
              inputLow && reference
                ? undefined
                : reference
                  ? t("models.form.inputHintMin", { min: minText(reference.input) })
                  : t("models.form.inputHint")
            }
          >
            <Input
              id="model-in"
              type="number"
              min={reference?.input ?? 0}
              step="any"
              placeholder={reference ? money(reference.input) : "0.00"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            {inputLow && reference && (
              <p className="text-xs text-destructive">
                {t("models.form.belowMin", { min: minText(reference.input) })}
              </p>
            )}
          </Field>
          <Field
            id="model-out"
            label={t("models.form.output")}
            hint={
              outputLow && reference?.output != null
                ? undefined
                : reference?.output != null
                  ? t("models.form.outputHintMin", { min: minText(reference.output) })
                  : t("models.form.outputHint")
            }
          >
            <Input
              id="model-out"
              type="number"
              min={reference?.output ?? 0}
              step="any"
              placeholder={reference?.output != null ? money(reference.output) : "0.00"}
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            />
            {outputLow && reference?.output != null && (
              <p className="text-xs text-destructive">
                {t("models.form.belowMin", { min: minText(reference.output) })}
              </p>
            )}
          </Field>
        </div>
        {reference ? (
          <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
            <p className="font-medium">
              {t("models.ref.title", {
                date: new Date(reference.checked).toLocaleDateString(locale, { dateStyle: "long" }),
              })}
            </p>
            <p>
              {t("models.ref.prices", {
                input: `$${money(reference.input)}`,
                output: reference.output === null ? "—" : `$${money(reference.output)}`,
              })}
            </p>
            {reference.noteKey && (
              <p className="text-xs text-muted-foreground">{t(`models.${reference.noteKey}`)}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setInput(String(reference.input));
                  setOutput(reference.output === null ? "" : String(reference.output));
                }}
              >
                {t("models.ref.use")}
              </Button>
              <a
                href={reference.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                {t("models.ref.check")}
              </a>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("models.ref.none")}{" "}
            {pricingPage && (
              <a href={pricingPage} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {t("models.ref.check")}
              </a>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {reference ? t("models.form.floorHelp") : t("models.form.priceHelp")}
        </p>
      </div>
      <Field id="model-data" label={t("models.form.dataClass")} hint={t("models.form.dataClassHint")}>
        <select
          id="model-data"
          value={maxDataClass}
          onChange={(e) => setMaxDataClass(e.target.value as AdminModel["maxDataClass"])}
          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
        >
          {(Object.keys(DATA_ALLOWED) as Array<keyof typeof DATA_ALLOWED>).map((c) => (
            <option key={c} value={c}>
              {t(DATA_ALLOWED[c])}
            </option>
          ))}
        </select>
      </Field>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t("models.form.more")}</summary>
        <div className="mt-3">
          <Field id="model-quality" label={t("models.form.quality")} hint={t("models.form.qualityHint")}>
            <Input
              id="model-quality"
              type="number"
              min={0}
              max={1}
              step="any"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            />
          </Field>
        </div>
      </details>
      {update.error && <p className="text-sm text-destructive">{update.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={update.isPending || !name.trim() || inputLow || outputLow}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

/** A column heading with a short plain-language line under it. */
function Th({ label, hint }: { label: string; hint: string }) {
  return (
    <th className="px-4 py-3 align-top font-medium">
      {label}
      <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>
    </th>
  );
}

/** What the model costs, in plain words; a model with no price says so, because its usage then counts as $0. */
function PriceCell({ model }: { model: AdminModel }) {
  const t = useT();
  if (model.inputUsdPerMtok === null && model.outputUsdPerMtok === null)
    return (
      <span className="inline-flex flex-col leading-tight">
        <span className="font-medium text-amber-700">{t("models.priceNotSet")}</span>
        <span className="text-xs text-muted-foreground">{t("models.priceNotSetHint")}</span>
      </span>
    );
  const show = (n: number | null) => (n === null ? "—" : `$${money(n)}`);
  const below = !checkPriceFloor(model.provider, model.modelId, model.inputUsdPerMtok, model.outputUsdPerMtok)
    .ok;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{t("models.priceIn", { value: show(model.inputUsdPerMtok) })}</span>
      <span>{t("models.priceOut", { value: show(model.outputUsdPerMtok) })}</span>
      {below && <span className="text-xs font-medium text-destructive">{t("models.priceBelow")}</span>}
    </span>
  );
}

/** This month's use of a model, in tokens and in both currencies. */
function ModelUsageCell({
  usage,
}: {
  usage?: { totalTokens: number; costMicroUsd: number; costIdr: number; people: number };
}) {
  const t = useT();
  if (!usage || usage.totalTokens === 0)
    return <span className="text-muted-foreground">{t("models.noUsage")}</span>;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>
        {usd(usage.costMicroUsd)}{" "}
        <span className="text-xs text-muted-foreground">· {idr(usage.costIdr)}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {t("models.usageDetail", { tokens: formatNumber(usage.totalTokens), people: usage.people })}
      </span>
    </span>
  );
}

/** The organizations a model appears in, by name. Long lists are shortened; hovering shows all of them. */
function OrgNames({ orgs }: { orgs: AdminModel["orgs"] }) {
  const t = useT();
  if (orgs.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = orgs.slice(0, 3);
  const rest = orgs.length - shown.length;
  return (
    <div
      className="flex max-w-64 flex-wrap gap-1"
      title={orgs.map((o) => (o.enabled ? o.name : `${o.name} (${t("models.orgOff")})`)).join(", ")}
    >
      {shown.map((o) => (
        <span
          key={o.id}
          className={cn(
            "max-w-40 truncate rounded-md bg-muted px-2 py-0.5 text-xs",
            !o.enabled && "text-muted-foreground line-through",
          )}
        >
          {o.name}
        </span>
      ))}
      {rest > 0 && (
        <span className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground">
          {t("models.orgMore", { count: rest })}
        </span>
      )}
    </div>
  );
}

function Registry() {
  const t = useT();
  const usage = useSystemModelUsage();
  const queryClient = useQueryClient();
  const { data: all = [] } = useQuery(orpc.admin.models.list.queryOptions());
  // The registry shows what is active (listed); inactive models stay in the database with their settings.
  const models = all.filter((m) => m.listed);
  const [form, setForm] = useState<AdminModel | null>(null);
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
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("models.registry")}</h2>
          <p className="text-sm text-muted-foreground">{t("models.registryDesc")}</p>
        </div>
      </div>
      <details className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">{t("models.help.title")}</summary>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          <li>{t("models.help.cost")}</li>
          <li>{t("models.help.data")}</li>
          <li>{t("models.help.orgs")}</li>
          <li>{t("models.help.enabled")}</li>
        </ul>
      </details>
      {form && <ModelForm key={form.id} model={form} onDone={() => setForm(null)} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t("models.col.model")}</th>
              <Th label={t("models.col.prices")} hint={t("models.col.pricesHint")} />
              <Th label={t("models.col.dataClass")} hint={t("models.col.dataHint")} />
              <Th label={t("models.col.orgs")} hint={t("models.col.orgsHint")} />
              <th className="px-4 py-3 font-medium">{t("models.col.usage")}</th>
              <Th label={t("models.col.active")} hint={t("models.col.activeHint")} />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr
                key={m.id}
                className={cn("border-b border-border last:border-0", !m.providerConnected && "opacity-60")}
              >
                <td className="px-4 py-3">
                  <p className="font-medium">{m.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.provider} · {m.modelId}
                    {!m.providerConnected && (
                      <span className="ml-2 text-amber-700">{t("models.providerOffNote")}</span>
                    )}
                  </p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <PriceCell model={m} />
                </td>
                <td className="px-4 py-3">{t(DATA_ALLOWED[m.maxDataClass])}</td>
                <td className="px-4 py-3">
                  <OrgNames orgs={m.orgs} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <ModelUsageCell usage={usage.model(m.provider, m.modelId)} />
                </td>
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
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
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
                    className={cn(
                      "border-b border-border last:border-0",
                      (!r.active || !r.providerConnected) && "opacity-70",
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.provider} · {r.model}
                        {!r.providerConnected ? (
                          <span className="ml-2 text-amber-700">{t("models.providerOffNote")}</span>
                        ) : (
                          !r.active && (
                            <span className="ml-2 text-destructive">{t("models.globalOffNote")}</span>
                          )
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
      <ProvidersSection />
      <Registry />
      <PerOrganization />
    </div>
  );
}
