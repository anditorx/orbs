import type { BudgetStatus, TeamUsageRow, UsageByModel, UsageByProject } from "@orbs/protocol";
import { isOrgAdmin, periodOf } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, RotateCcw, Trash2, Users } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { getLang, localeOf, t as tNow, useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";

// Numbers follow the interface language (1,234 in English, 1.234 in Indonesian).
const num = (n: number) => Math.round(n).toLocaleString(localeOf(getLang()));
const idr = (n: number) => `Rp ${num(n)}`;
const unitValue = (unit: "tokens" | "idr", n: number) =>
  unit === "idr" ? idr(n) : `${num(n)} ${tNow("usage.tokenWord")}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={cn("px-4 py-2 font-medium", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function BudgetBar({ b }: { b: BudgetStatus }) {
  const t = useT();
  const pct = Math.min(100, b.percent);
  const tone = b.exceeded ? "bg-destructive" : b.percent >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {b.projectName ? t("usage.projectBudget", { name: b.projectName }) : t("usage.allProjects")} ·{" "}
          {b.unit === "idr" ? t("usage.rupiah") : t("usage.tokens")} {t("usage.perMonth")}
          {b.userId === null && (
            <span className="ml-2 text-xs text-muted-foreground">{t("usage.workspaceDefault")}</span>
          )}
        </span>
        <span className="text-muted-foreground">
          {t("usage.usedOf", { used: unitValue(b.unit, b.used), limit: unitValue(b.unit, b.limit) })}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <p className={cn("mt-1.5 text-xs", b.exceeded ? "text-destructive" : "text-muted-foreground")}>
        {b.exceeded
          ? t("usage.limitReached")
          : t("usage.remaining", { remaining: unitValue(b.unit, b.remaining), percent: b.percent })}
      </p>
    </div>
  );
}

function ProjectTable({ rows }: { rows: UsageByProject[] }) {
  const t = useT();
  if (rows.length === 0) return <Empty text={t("common.noUsage")} />;
  return (
    <Table
      head={[t("usage.col.project"), t("usage.col.requests"), t("usage.col.tokens"), t("usage.col.cost")]}
    >
      {rows.map((r) => (
        <tr key={r.projectId ?? "none"} className="border-b border-border last:border-0">
          <td className="px-4 py-2">
            {r.projectId ? (r.projectName ?? t("usage.projectDeleted")) : t("usage.noProject")}
          </td>
          <td className="px-4 py-2 text-right">{num(r.requests)}</td>
          <td className="px-4 py-2 text-right">{num(r.totalTokens)}</td>
          <td className="px-4 py-2 text-right">{idr(r.costIdr)}</td>
        </tr>
      ))}
    </Table>
  );
}

function ModelTable({ rows }: { rows: UsageByModel[] }) {
  const t = useT();
  if (rows.length === 0) return <Empty text={t("common.noUsage")} />;
  return (
    <Table head={[t("usage.col.model"), t("usage.col.requests"), t("usage.col.tokens"), t("usage.col.cost")]}>
      {rows.map((r) => (
        <tr key={`${r.provider}/${r.modelId}`} className="border-b border-border last:border-0">
          <td className="px-4 py-2">
            {r.modelId} <span className="text-xs text-muted-foreground">{r.provider}</span>
          </td>
          <td className="px-4 py-2 text-right">{num(r.requests)}</td>
          <td className="px-4 py-2 text-right">{num(r.totalTokens)}</td>
          <td className="px-4 py-2 text-right">{idr(r.costIdr)}</td>
        </tr>
      ))}
    </Table>
  );
}

function DayBars({ rows }: { rows: Array<{ day: string; totalTokens: number; costIdr: number }> }) {
  const t = useT();
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.totalTokens), 1);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex h-24 items-end gap-1">
        {rows.map((r) => (
          <div
            key={r.day}
            title={`${r.day}: ${num(r.totalTokens)} ${t("usage.tokenWord")} · ${idr(r.costIdr)}`}
            className="min-w-1 flex-1 rounded-t bg-primary/70"
            style={{ height: `${Math.max(4, (r.totalTokens / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("usage.chartHint")}</p>
    </div>
  );
}

function MyUsage({ period }: { period: string }) {
  const t = useT();
  const { data } = useQuery(orpc.usage.mine.queryOptions({ input: { period } }));
  if (!data) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  const tot = data.totals;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("usage.totalCost")} value={idr(tot.costIdr)} />
        <Stat
          label={t("usage.totalTokens")}
          value={num(tot.totalTokens)}
          hint={t("usage.tokensInOut", { input: num(tot.inputTokens), output: num(tot.outputTokens) })}
        />
        <Stat
          label={t("usage.cachedTokens")}
          value={num(tot.cachedInputTokens)}
          hint={t("usage.cachedHint")}
        />
        <Stat
          label={t("usage.requests")}
          value={num(tot.requests)}
          hint={tot.reasoningTokens ? t("usage.reasoning", { count: num(tot.reasoningTokens) }) : undefined}
        />
      </div>
      {data.budgets.length > 0 && (
        <Section title={t("usage.budgetsThisMonth")}>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.budgets.map((b) => (
              <BudgetBar key={b.id} b={b} />
            ))}
          </div>
        </Section>
      )}
      <Section title={t("usage.daily")}>
        <DayBars rows={data.byDay} />
        {data.byDay.length === 0 && <Empty text={t("common.noUsage")} />}
      </Section>
      <Section title={t("usage.byProject")}>
        <ProjectTable rows={data.byProject} />
      </Section>
      <Section title={t("usage.byModel")}>
        <ModelTable rows={data.byModel} />
      </Section>
    </div>
  );
}

function tightest(budgets: BudgetStatus[]) {
  return [...budgets].sort((a, b) => b.percent - a.percent)[0];
}

function UserDetail({ userId, period, onClose }: { userId: string; period: string; onClose: () => void }) {
  const t = useT();
  const { data } = useQuery(orpc.usage.userDetail.queryOptions({ input: { userId, period } }));
  if (!data) return null;
  return (
    <div className="space-y-4 rounded-2xl border border-primary/40 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{data.user.name}</h3>
          <p className="text-xs text-muted-foreground">
            {data.user.email} · {idr(data.totals.costIdr)} · {num(data.totals.totalTokens)}{" "}
            {t("usage.tokenWord")}
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t("usage.detail.privacy")}
      </p>
      {data.budgets.map((b) => (
        <BudgetBar key={b.id} b={b} />
      ))}
      <Section title={t("usage.detail.forProject")}>
        <ProjectTable rows={data.byProject} />
      </Section>
      <Section title={t("usage.detail.conversations")}>
        {data.byThread.length === 0 ? (
          <Empty text={t("common.noUsage")} />
        ) : (
          <Table
            head={[
              t("usage.col.conversation"),
              t("usage.col.project"),
              t("usage.col.requests"),
              t("usage.col.tokens"),
              t("usage.col.cost"),
            ]}
          >
            {data.byThread.map((r) => (
              <tr key={r.threadId ?? "none"} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  {r.threadId ? t("usage.detail.privateTitle", { id: r.threadId.slice(0, 8) }) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.projectId ? (r.projectName ?? t("usage.projectDeleted")) : t("usage.noProject")}
                </td>
                <td className="px-4 py-2 text-right">{num(r.requests)}</td>
                <td className="px-4 py-2 text-right">{num(r.totalTokens)}</td>
                <td className="px-4 py-2 text-right">{idr(r.costIdr)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <Section title={t("usage.detail.models")}>
        <ModelTable rows={data.byModel} />
      </Section>
    </div>
  );
}

function BudgetManager() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: budgets } = useQuery(orpc.usage.budgets.list.queryOptions());
  const { data: team } = useQuery(orpc.usage.team.queryOptions({ input: { projectId: null } }));
  const { data: projects } = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const { data: settings } = useQuery(orpc.usage.settings.get.queryOptions());
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [unit, setUnit] = useState<"tokens" | "idr">("idr");
  const [limit, setLimit] = useState("");
  const [fx, setFx] = useState("");
  const [deleting, setDeleting] = useState<BudgetStatus | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.usage.key() });
  const save = useMutation(
    orpc.usage.budgets.set.mutationOptions({
      onSuccess: async () => {
        setLimit("");
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    orpc.usage.budgets.delete.mutationOptions({
      onSuccess: async () => {
        setDeleting(null);
        await refresh();
      },
    }),
  );
  const saveFx = useMutation(orpc.usage.settings.set.mutationOptions({ onSuccess: refresh }));
  const members = team?.rows ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({
      userId: userId || null,
      projectId: projectId || null,
      unit,
      limit: Number(limit.replace(/\D/g, "")),
    });
  }

  const label = (b: BudgetStatus) =>
    members.find((m) => m.userId === b.userId)?.name ?? t("usage.allMembersShort");
  return (
    <div className="space-y-6">
      <Section title={t("usage.setLimit")}>
        <form
          onSubmit={submit}
          className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-5"
        >
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">{t("usage.allMembers")}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">{t("usage.allProjects")}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as "tokens" | "idr")}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="idr">{t("usage.rupiah")} (IDR)</option>
            <option value="tokens">{t("usage.tokens")}</option>
          </select>
          <Input
            inputMode="numeric"
            placeholder={unit === "idr" ? t("usage.limitPlaceholderIdr") : t("usage.limitPlaceholderTokens")}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
          />
          <Button type="submit" disabled={save.isPending || !limit}>
            {t("usage.saveLimit")}
          </Button>
          {save.error && (
            <p className="text-sm text-destructive sm:col-span-2 lg:col-span-5">{save.error.message}</p>
          )}
        </form>
        <p className="text-xs text-muted-foreground">{t("usage.limitNote")}</p>
      </Section>

      <Section title={t("usage.activeLimits")}>
        {!budgets || budgets.length === 0 ? (
          <Empty text={t("usage.noLimits")} />
        ) : (
          <Table
            head={[
              t("usage.col.appliesTo"),
              t("usage.col.project"),
              t("usage.col.unit"),
              t("usage.col.limit"),
              "",
            ]}
          >
            {budgets.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{label(b)}</td>
                <td className="px-4 py-2 text-right">{b.projectName ?? t("usage.allProjects")}</td>
                <td className="px-4 py-2 text-right">
                  {b.unit === "idr" ? t("usage.rupiah") : t("usage.tokens")}
                </td>
                <td className="px-4 py-2 text-right">{unitValue(b.unit, b.limit)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    aria-label={t("usage.deleteLimitAria")}
                    onClick={() => setDeleting(b)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t("usage.rate")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveFx.mutate({ fxUsdIdr: Number(fx) });
          }}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-5"
        >
          <span className="text-sm">{t("usage.rateEquals")}</span>
          <Input
            className="w-36"
            inputMode="decimal"
            placeholder={String(settings?.fxUsdIdr ?? 16000)}
            value={fx}
            onChange={(e) => setFx(e.target.value)}
          />
          <span className="text-sm">{t("usage.rupiah")}</span>
          <Button type="submit" disabled={!fx || saveFx.isPending}>
            {t("usage.saveRate")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            {t("usage.rateNow", { rate: num(settings?.fxUsdIdr ?? 16000) })}
          </p>
          {saveFx.error && <p className="w-full text-sm text-destructive">{saveFx.error.message}</p>}
        </form>
      </Section>

      <ConfirmDialog
        open={deleting !== null}
        title={t("usage.deleteLimitTitle")}
        description={t("usage.deleteLimitBody")}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function TeamUsage({ period }: { period: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [detailUser, setDetailUser] = useState<string | null>(null);
  const [resetting, setResetting] = useState<TeamUsageRow | null>(null);
  const { data: projects } = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const { data } = useQuery(
    orpc.usage.team.queryOptions({ input: { period, projectId: projectId || null } }),
  );
  const reset = useMutation(
    orpc.usage.reset.mutationOptions({
      onSuccess: async () => {
        setResetting(null);
        await queryClient.invalidateQueries({ queryKey: orpc.usage.key() });
      },
    }),
  );
  if (!data) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("usage.teamCost")} value={idr(data.totals.costIdr)} />
        <Stat label={t("usage.teamTokens")} value={num(data.totals.totalTokens)} />
        <Stat label={t("usage.requests")} value={num(data.totals.requests)} />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="usage-project" className="text-sm text-muted-foreground">
          {t("usage.view")}
        </label>
        <select
          id="usage-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
        >
          <option value="">{t("usage.viewGlobal")}</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {t("usage.projectBudget", { name: p.name })}
            </option>
          ))}
        </select>
      </div>
      <Table
        head={[
          t("usage.col.member"),
          t("usage.col.requests"),
          t("usage.col.tokens"),
          t("usage.col.cost"),
          t("usage.col.share"),
          t("usage.col.remaining"),
          "",
        ]}
      >
        {data.rows.map((r, i) => {
          const b = tightest(r.budgets);
          return (
            <tr key={r.userId} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                <span className="mr-2 text-xs text-muted-foreground">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => setDetailUser(r.userId)}
                  className="font-medium hover:underline"
                >
                  {r.name}
                </button>
                <span className="block pl-5 text-xs text-muted-foreground">{r.email}</span>
              </td>
              <td className="px-4 py-2 text-right">{num(r.requests)}</td>
              <td className="px-4 py-2 text-right">{num(r.totalTokens)}</td>
              <td className="px-4 py-2 text-right">{idr(r.costIdr)}</td>
              <td className="px-4 py-2 text-right">{r.sharePercent}%</td>
              <td className={cn("px-4 py-2 text-right", b?.exceeded && "text-destructive")}>
                {b
                  ? b.exceeded
                    ? t("usage.exhausted")
                    : unitValue(b.unit, b.remaining)
                  : t("usage.noLimit")}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  aria-label={t("usage.resetAria", { name: r.name })}
                  title={t("usage.resetTitle")}
                  onClick={() => setResetting(r)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <RotateCcw className="size-4" />
                </button>
              </td>
            </tr>
          );
        })}
      </Table>
      {detailUser && <UserDetail userId={detailUser} period={period} onClose={() => setDetailUser(null)} />}
      <ConfirmDialog
        open={resetting !== null}
        title={t("usage.resetConfirmTitle")}
        description={t("usage.resetBody", {
          name: resetting?.name ?? "",
          scope: projectId ? t("usage.resetScopeProject") : t("usage.resetScopeAll"),
        })}
        confirmLabel={t("usage.reset")}
        busy={reset.isPending}
        onConfirm={() =>
          resetting && reset.mutate({ userId: resetting.userId, projectId: projectId || null })
        }
        onCancel={() => setResetting(null)}
      />
    </div>
  );
}

type Tab = "mine" | "team" | "budgets";

export function UsagePage() {
  const t = useT();
  const { data: me } = useQuery(orpc.me.queryOptions());
  const isAdmin = isOrgAdmin(me?.role) || me?.isSystemAdmin === true;
  const [tab, setTab] = useState<Tab>("mine");
  const [period, setPeriod] = useState(periodOf(new Date()));
  const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
    { id: "mine", label: t("usage.tab.mine"), icon: BarChart3 },
    ...(isAdmin
      ? [
          { id: "team" as const, label: t("usage.tab.team"), icon: Users },
          { id: "budgets" as const, label: t("usage.tab.budgets"), icon: RotateCcw },
        ]
      : []),
  ];
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t("usage.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("usage.subtitle")}</p>
          </div>
          {tab !== "budgets" && (
            <Input
              type="month"
              className="w-44"
              value={period}
              max={periodOf(new Date())}
              onChange={(e) => e.target.value && setPeriod(e.target.value)}
            />
          )}
        </div>
        <div className="flex gap-1 border-b border-border">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
                tab === id
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {tab === "mine" && <MyUsage period={period} />}
        {tab === "team" && isAdmin && <TeamUsage period={period} />}
        {tab === "budgets" && isAdmin && <BudgetManager />}
      </div>
    </div>
  );
}
