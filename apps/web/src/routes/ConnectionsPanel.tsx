import type { ConnectorProviderStatus, ConnectorTool } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderLogo } from "../components/ProviderLogo.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { CopyField } from "../components/ui/copy-field.tsx";
import { Input } from "../components/ui/input.tsx";
import { SecretInput } from "../components/ui/secret-input.tsx";
import { Tabs } from "../components/ui/tabs.tsx";
import { type MessageKey, useLocale, useT } from "../i18n/index.ts";
import { orpc, rpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";
import { AddConnectionDialog } from "./AddConnection.tsx";
import { ConnectionRow, type Tone } from "./ConnectionRow.tsx";
import { CustomServers } from "./CustomServers.tsx";
import { ToolRunner } from "./ToolRunner.tsx";

const KIND_LABEL = {
  read: "conn.kind.read",
  write: "conn.kind.write",
  destructive: "conn.kind.destructive",
  interactive: "conn.kind.interactive",
  unknown: "conn.kind.unknown",
} as const satisfies Record<ConnectorTool["kind"], MessageKey>;

const ERROR_KEYS: Record<string, MessageKey> = {
  vault_missing: "conn.error.vault_missing",
  not_configured: "conn.error.not_configured",
  unknown_provider: "conn.error.unknown_provider",
  state_invalid: "conn.error.state_invalid",
  state_expired: "conn.error.state_expired",
  wrong_user: "conn.error.wrong_user",
  denied: "conn.error.denied",
  issuer_mismatch: "conn.error.issuer_mismatch",
  exchange_failed: "conn.error.exchange_failed",
  upstream: "conn.error.upstream",
  rate_limited: "conn.error.rate_limited",
  token_rejected: "conn.error.token_rejected",
};

function Tools({ provider }: { provider: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    ...orpc.connections.tools.queryOptions({ input: { provider } }),
    enabled: open,
    staleTime: 60_000,
  });
  const allowed = data?.filter((x) => x.allowed) ?? [];
  const blocked = data?.filter((x) => !x.allowed) ?? [];

  const group = (label: string, items: ConnectorTool[], tone: string, pick = false) =>
    items.length > 0 && (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {items.map((tool) => (
            <li key={tool.name} title={tool.description}>
              {pick ? (
                <button
                  type="button"
                  onClick={() => setPicked(tool.name)}
                  aria-pressed={picked === tool.name}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left hover:bg-muted",
                    picked === tool.name ? "border-primary bg-accent" : "border-border",
                  )}
                >
                  <p className="truncate font-mono text-xs">{tool.name}</p>
                  <span className={cn("text-[11px]", tone)}>{t(KIND_LABEL[tool.kind])}</span>
                </button>
              ) : (
                <div className="rounded-lg border border-border px-3 py-2 opacity-70">
                  <p className="truncate font-mono text-xs">{tool.name}</p>
                  <span className={cn("text-[11px]", tone)}>{t(KIND_LABEL[tool.kind])}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    );

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
          <p className="text-xs text-muted-foreground">{t("conn.toolsDesc")}</p>
          {isLoading && <p className="text-sm text-muted-foreground">{t("conn.toolsLoading")}</p>}
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          {group(t("conn.toolsAllowed", { count: allowed.length }), allowed, "text-emerald-600", true)}
          {allowed.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t("conn.explore.title")}</p>
              <ToolRunner
                tool={allowed.find((x) => x.name === picked) ?? null}
                call={(tool, args) => rpc.connections.call({ provider, tool, args })}
              />
            </div>
          )}
          {group(t("conn.toolsBlocked", { count: blocked.length }), blocked, "text-muted-foreground")}
        </div>
      )}
    </div>
  );
}

/**
 * Which workspaces of the account the assistant may look in. Shown only for a token connection whose account has more
 * than one (a sign-in connection belongs to the single workspace chosen when it was authorized).
 */
function WorkspaceChooser({
  item,
  onMessage,
}: {
  item: ConnectorProviderStatus;
  onMessage: (m: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const query = orpc.connections.workspaces.queryOptions({ input: { provider: item.provider } });
  const { data } = useQuery({ ...query, staleTime: 60_000 });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const saved = new Set((data?.workspaces ?? []).filter((w) => w.enabled).map((w) => w.gid));
  const selected = picked ?? saved;
  const changed = picked !== null && (picked.size !== saved.size || [...picked].some((g) => !saved.has(g)));
  const save = useMutation(
    orpc.connections.setWorkspaces.mutationOptions({
      onSuccess: async () => {
        setPicked(null);
        onMessage(t("conn.ws.saved", { name: item.name }));
        await queryClient.invalidateQueries({ queryKey: orpc.connections.key() });
      },
    }),
  );
  if (!data?.choosable) return null;
  const toggle = (gid: string) => {
    const next = new Set(selected);
    if (next.has(gid)) next.delete(gid);
    else next.add(gid);
    setPicked(next);
  };
  return (
    <fieldset className="space-y-2 rounded-lg border border-border bg-card p-4">
      <legend className="px-1 text-sm font-medium">{t("conn.ws.title")}</legend>
      <p className="text-xs text-muted-foreground">{t("conn.ws.help", { name: item.name })}</p>
      <ul className="space-y-1.5">
        {data.workspaces.map((w) => (
          <li key={w.gid}>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(w.gid)}
                onChange={() => toggle(w.gid)}
                className="size-4 accent-primary"
              />
              {w.name}
            </label>
          </li>
        ))}
      </ul>
      {selected.size === 0 && <p className="text-xs text-destructive">{t("conn.ws.atLeastOne")}</p>}
      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      <Button
        onClick={() => save.mutate({ provider: item.provider, gids: [...selected] })}
        disabled={!changed || selected.size === 0 || save.isPending}
      >
        {save.isPending ? t("conn.ws.saving") : t("conn.ws.save")}
      </Button>
    </fieldset>
  );
}

/** The simple way in: paste one token. It is checked against the service before anything is saved. */
function TokenForm({ item, onMessage }: { item: ConnectorProviderStatus; onMessage: (m: string) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const field = `token-${item.provider}`;
  const connect = useMutation(
    orpc.connections.connectWithToken.mutationOptions({
      onSuccess: async (account) => {
        setToken("");
        onMessage(t("conn.justConnected", { name: account.name ?? account.email ?? item.name }));
        await queryClient.invalidateQueries({ queryKey: orpc.connections.key() });
      },
    }),
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        connect.mutate({ provider: item.provider, token });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={field} className="block text-sm font-medium">
          {t("conn.token.label", { name: item.name })}
        </label>
        <SecretInput id={field} value={token} onChange={(e) => setToken(e.target.value)} required />
        <p className="text-xs text-muted-foreground">
          {item.connection?.authMethod === "token" ? t("conn.token.replaceHelp") : t("conn.token.help")}
          {item.provider === "asana" && ` ${t("conn.token.asanaHelp")}`}
        </p>
      </div>
      {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
      <Button type="submit" disabled={!item.vaultReady || connect.isPending || !token.trim()}>
        {connect.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {connect.isPending ? t("conn.token.connecting") : t("conn.token.connect")}
      </Button>
    </form>
  );
}

/** Lets a person register their own OAuth app instead of waiting for a shared one. */
function OwnApp({ item, onMessage }: { item: ConnectorProviderStatus; onMessage: (m: string) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [appName, setAppName] = useState(item.ownApp?.appName ?? "");
  const [description, setDescription] = useState(item.ownApp?.description ?? "");
  const [clientId, setClientId] = useState(item.ownApp?.clientId ?? "");
  const [secret, setSecret] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.connections.key() });
  const save = useMutation(
    orpc.connections.setOwnApp.mutationOptions({
      onSuccess: async () => {
        setSecret("");
        onMessage(t("conn.own.saved"));
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    orpc.connections.clearOwnApp.mutationOptions({
      onSuccess: async () => {
        setAppName("");
        setDescription("");
        setClientId("");
        setSecret("");
        onMessage(t("conn.own.removed"));
        await refresh();
      },
    }),
  );
  const nameField = `own-${item.provider}-name`;
  const descField = `own-${item.provider}-desc`;
  const idField = `own-${item.provider}-id`;
  const secretField = `own-${item.provider}-secret`;
  // A stored secret stays when the field is left empty, as long as it is still the same app.
  const secretKept = Boolean(item.ownApp) && clientId.trim() === item.ownApp?.clientId;
  const complete = appName.trim() && clientId.trim() && (secret.trim() || secretKept);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          provider: item.provider,
          clientId,
          clientSecret: secret.trim() || undefined,
          appName,
          description: description || undefined,
        });
      }}
    >
      <div>
        <h4 className="text-sm font-medium">{item.ownApp ? t("conn.own.titleSet") : t("conn.own.title")}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t("conn.own.desc", { name: item.name })}</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">{t("conn.own.redirect")}</p>
        <CopyField value={item.redirectUri} />
        <p className="text-xs text-muted-foreground">{t("conn.oob.note", { name: item.name })}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={nameField} className="block text-sm font-medium">
            {t("conn.own.appName")}
          </label>
          <Input
            id={nameField}
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            maxLength={100}
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={descField} className="block text-sm font-medium">
            {t("conn.own.shortDescription")}
          </label>
          <Input
            id={descField}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={idField} className="block text-sm font-medium">
            {t("conn.own.clientId")}
          </label>
          <Input
            id={idField}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={secretField} className="block text-sm font-medium">
            {t("conn.own.clientSecret")}
          </label>
          <SecretInput
            id={secretField}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            required={!secretKept}
            placeholder={secretKept ? "••••••••••••••••" : undefined}
          />
          {secretKept && (
            <p className="text-xs text-muted-foreground">
              {t("conn.own.secretStored", { hint: item.ownApp?.secretHint ?? "…" })}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("conn.own.resets", { name: item.name })}</p>
      {(save.error || remove.error) && (
        <p className="text-sm text-destructive">{(save.error ?? remove.error)?.message}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!item.vaultReady || save.isPending || !complete}>
          {t("conn.own.save")}
        </Button>
        {item.ownApp && (
          <Button
            variant="ghost"
            onClick={() => remove.mutate({ provider: item.provider })}
            disabled={remove.isPending}
          >
            {t("conn.own.remove")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** What Asana's approval page shows, for example "2/1211/1220:59cd". Nothing else on the clipboard is ever used. */
const ASANA_CODE = /^\d+\/\d+\/\d+:[0-9a-f]+$/;

/**
 * Asana can't redirect to an address without https, and a page can't read another site's tab, so the person copies
 * the code once. Everything after that is done here: coming back to Orbs picks the code off the clipboard (the browser
 * asks permission first), and pasting it by hand finishes at once. An attempt works only once on the server.
 */
function PasteCode({
  item,
  url,
  state,
  opened,
  onDone,
}: {
  item: ConnectorProviderStatus;
  url: string;
  state: string;
  /** The browser may have blocked the new tab; then the link below is the way there. */
  opened: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const tried = useRef(false);
  const field = `code-${item.provider}`;
  const finish = useMutation(orpc.connections.finish.mutationOptions({ onSuccess: onDone }));
  const { mutate } = finish;
  const submit = useCallback(
    (value: string) => {
      const clean = value.trim();
      if (!clean || tried.current) return;
      tried.current = true;
      setCode(clean);
      mutate({ state, code: clean });
    },
    [mutate, state],
  );

  useEffect(() => {
    const check = () => {
      // Permission can be refused and some browsers have no such API; typing or pasting still works then.
      navigator.clipboard
        ?.readText()
        .then((text) => {
          if (ASANA_CODE.test(text.trim())) submit(text);
        })
        .catch(() => {});
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [submit]);

  return (
    <form
      className="space-y-3 rounded-lg border border-primary/40 bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(code);
      }}
    >
      <p className="text-sm">{t(opened ? "conn.oob.desc" : "conn.oob.descBlocked", { name: item.name })}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ExternalLink className="size-4" />{" "}
        {t(opened ? "conn.oob.open" : "conn.oob.openFirst", { name: item.name })}
      </a>
      <div className="space-y-1.5">
        <label htmlFor={field} className="block text-sm font-medium">
          {t("conn.oob.code", { name: item.name })}
        </label>
        <Input
          id={field}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            submit(e.clipboardData.getData("text"));
          }}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      {finish.error && (
        <p className="text-sm text-destructive">
          {finish.error.message} {t("conn.oob.retry")}
        </p>
      )}
      <Button type="submit" disabled={finish.isPending || finish.isError || !code.trim()}>
        {finish.isPending ? t("conn.oob.finishing") : t("conn.oob.finish")}
      </Button>
    </form>
  );
}

function ProviderRow({ item, onMessage }: { item: ConnectorProviderStatus; onMessage: (m: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"token" | "mcp">("token");
  const [paste, setPaste] = useState<{ url: string; state: string; opened: boolean } | null>(null);
  const conn = item.connection;
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.connections.key() });

  const start = useMutation(orpc.connections.start.mutationOptions());
  // Between the server answering and the browser actually leaving, the button must not look idle.
  const [leaving, setLeaving] = useState(false);
  // Coming back with the browser's back button restores this page as it was; the button must work again.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const connect = (mode: "redirect" | "code" = "redirect") => {
    // With a code Orbs stays here waiting for it, so the provider opens in its own tab. The tab has to be opened during
    // the click: browsers block one opened later, when the server has answered.
    const tab = mode === "code" ? window.open("", "_blank") : null;
    start.mutate(
      { provider: item.provider, mode },
      {
        onSuccess: ({ url, state }) => {
          if (!state) {
            // The provider's page takes over the window and sends the person back to Orbs when done.
            setLeaving(true);
            window.location.assign(url);
            return;
          }
          setPaste({ url, state, opened: Boolean(tab) });
          setMethod("mcp");
          setOpen(true);
          if (tab) {
            tab.opener = null;
            tab.location.href = url;
          }
        },
        onError: (e: Error) => {
          tab?.close();
          onMessage(e.message);
        },
      },
    );
  };
  const test = useMutation(
    orpc.connections.test.mutationOptions({
      onSuccess: async (account) => {
        onMessage(t("conn.testOk", { name: account.name ?? account.email ?? item.name }));
        await refresh();
      },
      onError: async (e: Error) => {
        onMessage(e.message);
        await refresh();
      },
    }),
  );
  const disconnect = useMutation(
    orpc.connections.disconnect.mutationOptions({
      onSuccess: async () => {
        setConfirming(false);
        onMessage(t("conn.disconnected"));
        await refresh();
      },
    }),
  );

  // Not having an OAuth app is no reason to call it "not set up": pasting a token works without one.
  const status: { label: MessageKey; tone: Tone; hint?: MessageKey } = !item.vaultReady
    ? { label: "conn.status.vaultMissing", tone: "idle", hint: "conn.hint.vaultMissing" }
    : conn?.status === "needs_reauth"
      ? { label: "conn.status.needsReauth", tone: "warn", hint: "conn.hint.needsReauth" }
      : conn
        ? { label: "conn.status.active", tone: "ok" }
        : { label: "conn.status.notConnected", tone: "idle" };

  // A connection made with a pasted token needs no OAuth app.
  const usable = item.vaultReady && (item.configured || conn?.authMethod === "token");
  const date = (value: string) =>
    new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const subtitle = conn
    ? [conn.accountName ?? conn.accountEmail, conn.workspaceName].filter(Boolean).join(" · ")
    : undefined;

  // The one thing to do next, right in the row.
  const primary =
    usable && (!conn || (conn.status === "needs_reauth" && conn.authMethod === "oauth")) ? (
      <Button onClick={() => connect()} disabled={start.isPending || leaving}>
        {start.isPending || leaving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Link2 className="size-4" />
        )}
        {start.isPending || leaving ? t("conn.connecting") : conn ? t("conn.reconnect") : t("conn.connect")}
      </Button>
    ) : !usable && item.vaultReady ? (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("conn.connect")}
      </Button>
    ) : null;

  return (
    <ConnectionRow
      logo={<ProviderLogo provider={item.provider} />}
      title={item.name}
      subtitle={subtitle}
      status={t(status.label)}
      tone={status.tone}
      actions={primary}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {status.hint && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {t(status.hint)}
        </p>
      )}

      {conn && (
        <div className="space-y-4">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t("conn.account")}</dt>
              <dd>{conn.accountName ?? conn.accountEmail ?? t("conn.unknown")}</dd>
              {conn.accountName && conn.accountEmail && (
                <dd className="text-xs text-muted-foreground">{conn.accountEmail}</dd>
              )}
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("conn.method")}</dt>
              <dd>{t(conn.authMethod === "token" ? "conn.authMethod.token" : "conn.authMethod.oauth")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("conn.workspace")}</dt>
              <dd>{conn.workspaceName ?? t("conn.unknown")}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {t("conn.connectedAt", { date: date(conn.connectedAt) })} ·{" "}
            {conn.lastUsedAt ? t("conn.lastUsed", { date: date(conn.lastUsedAt) }) : t("conn.neverUsed")}
          </p>
          <div className="flex gap-2">
            {usable && conn.status === "active" && (
              <Button
                variant="secondary"
                onClick={() => test.mutate({ provider: item.provider })}
                disabled={test.isPending}
              >
                {test.isPending ? t("conn.testing") : t("conn.test")}
              </Button>
            )}
            {/* Someone who lost access to the service can still remove what they saved. */}
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t("conn.disconnect")}
            </Button>
          </div>
        </div>
      )}

      {usable && conn?.status === "active" && conn.authMethod === "token" && (
        <WorkspaceChooser item={item} onMessage={onMessage} />
      )}

      {usable && conn?.status === "active" && <Tools provider={item.provider} />}

      {item.vaultReady && (
        <div className="space-y-4">
          <Tabs
            tabs={
              [
                { id: "token", label: t("conn.method.token"), icon: KeyRound },
                { id: "mcp", label: t("conn.method.mcp"), icon: Waypoints },
              ] as const
            }
            value={method}
            onChange={setMethod}
          />
          {method === "token" ? (
            <TokenForm item={item} onMessage={onMessage} />
          ) : (
            <div className="space-y-4">
              {paste && (
                <PasteCode
                  key={paste.state}
                  item={item}
                  url={paste.url}
                  state={paste.state}
                  opened={paste.opened}
                  onDone={async () => {
                    setPaste(null);
                    onMessage(t("conn.justConnected", { name: item.name }));
                    await refresh();
                  }}
                />
              )}
              {item.configured && (
                <div>
                  <Button onClick={() => connect()} disabled={start.isPending || leaving}>
                    {start.isPending || leaving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Link2 className="size-4" />
                    )}
                    {t("conn.mcp.connect", { name: item.name })}
                  </Button>
                  <button
                    type="button"
                    onClick={() => connect("code")}
                    disabled={start.isPending || leaving}
                    className="ml-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {t("conn.mcp.useCode", { name: item.name })}
                  </button>
                </div>
              )}
              <OwnApp key={item.ownApp?.clientId ?? ""} item={item} onMessage={onMessage} />
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={t("conn.disconnectTitle", { name: item.name })}
        description={t("conn.disconnectBody", { name: item.name })}
        confirmLabel={t("conn.disconnect")}
        busy={disconnect.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => disconnect.mutate({ provider: item.provider })}
      />
    </ConnectionRow>
  );
}

export function ConnectionsPanel() {
  const t = useT();
  const { data = [], isLoading } = useQuery(orpc.connections.list.queryOptions());
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [adding, setAdding] = useState(false);

  const queryClient = useQueryClient();
  const [finishing, setFinishing] = useState(false);

  // The provider sends the browser back here. Approving brings a code, which is finished right here while a message
  // says so; a denial or an error brings its outcome in the address. Either way the address is tidied at once, and
  // the code is used only once, so the work starts from what was read before the tidying.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("oauth_state");
    const code = params.get("oauth_code");
    const connected = params.get("connected");
    const failed = params.get("connection_error");
    if (!state && !connected && !failed) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (state && code) {
      setFinishing(true);
      rpc.connections
        .finish({
          state,
          code,
          ...(params.get("oauth_iss") ? { iss: params.get("oauth_iss") as string } : {}),
        })
        .then(async ({ provider }) => {
          setMessage({
            text: t("conn.justConnected", { name: provider === "asana" ? "Asana" : provider }),
            ok: true,
          });
          await queryClient.invalidateQueries({ queryKey: orpc.connections.key() });
        })
        .catch((e: Error) => setMessage({ text: e.message, ok: false }))
        .finally(() => setFinishing(false));
      return;
    }
    if (connected)
      setMessage({
        text: t("conn.justConnected", { name: connected === "asana" ? "Asana" : connected }),
        ok: true,
      });
    else if (failed) setMessage({ text: t(ERROR_KEYS[failed] ?? "conn.error.generic"), ok: false });
  }, [t, queryClient]);

  return (
    <div className="mt-6 space-y-5">
      <div className="flex items-start justify-between gap-6">
        <p className="max-w-xl text-sm text-muted-foreground">{t("conn.intro")}</p>
        <Button onClick={() => setAdding(true)} className="shrink-0">
          <Plus className="size-4" /> {t("conn.addConnection")}
        </Button>
      </div>
      {finishing && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary"
        >
          <Loader2 className="size-4 animate-spin" /> {t("conn.finishing")}
        </p>
      )}
      {message && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            message.ok ? "bg-emerald-500/10 text-emerald-700" : "bg-destructive/10 text-destructive",
          )}
        >
          {message.ok && <CheckCircle2 className="size-4" />} {message.text}
        </p>
      )}
      {!isLoading && data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("conn.noProviders")}</p>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {data.map((item) => (
          <ProviderRow key={item.provider} item={item} onMessage={(text) => setMessage({ text, ok: true })} />
        ))}
        <CustomServers />
      </ul>
      <AddConnectionDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
