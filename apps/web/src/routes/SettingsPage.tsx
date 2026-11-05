import { isOrgAdmin, ORG_ROLE, type OrgRoleName } from "@orbs/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Building2, Check, Copy, Keyboard, Mail, Palette, Trash2, UserRound } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { LANGUAGES, useLang, useRoleLabel, useT } from "../i18n/index.ts";
import { authClient } from "../lib/auth.ts";
import { ACCENTS, type ThemeMode, useTheme } from "../lib/theme.ts";
import { modKey } from "../lib/useShortcuts.ts";
import { cn } from "../lib/utils.ts";

export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "settings.appearance", icon: Palette },
  { id: "account", label: "settings.account", icon: UserRound },
  { id: "workspace", label: "settings.workspace", icon: Building2 },
  { id: "shortcuts", label: "settings.shortcuts", icon: Keyboard },
] as const;

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="font-medium">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Appearance() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { mode, accent, setMode, setAccent } = useTheme();
  const modes: Array<{ id: ThemeMode; label: string }> = [
    { id: "light", label: t("settings.light") },
    { id: "dark", label: t("settings.dark") },
    { id: "system", label: t("settings.system") },
  ];
  return (
    <div className="space-y-4">
      <Card title={t("settings.language")} description={t("settings.languageDesc")}>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <Button
              key={l.id}
              variant={lang === l.id ? "primary" : "secondary"}
              aria-pressed={lang === l.id}
              onClick={() => setLang(l.id)}
            >
              {l.label}
            </Button>
          ))}
        </div>
      </Card>
      <Card title={t("settings.colorMode")} description={t("settings.savedInBrowser")}>
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <Button
              key={m.id}
              variant={mode === m.id ? "primary" : "secondary"}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </Card>
      <Card title={t("settings.accent")}>
        <div className="flex flex-wrap gap-3">
          {ACCENTS.map((a) => (
            <button
              type="button"
              key={a.id}
              onClick={() => setAccent(a.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                accent === a.id ? "border-primary ring-2 ring-primary/20" : "border-border hover:bg-muted",
              )}
            >
              <span className="size-4 rounded-full" style={{ background: a.swatch }} />
              {t(a.label)}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Account() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setName(session?.user.name ?? ""), [session?.user.name]);

  async function save(e: FormEvent) {
    e.preventDefault();
    await authClient.updateUser({ name });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-4">
      <Card title={t("settings.profile")}>
        <form onSubmit={save} className="flex max-w-md flex-col gap-3">
          <label htmlFor="account-name" className="text-sm">
            {t("settings.name")}
          </label>
          <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} required />
          <label htmlFor="account-email" className="text-sm">
            {t("settings.email")}
          </label>
          <Input id="account-email" value={session?.user.email ?? ""} disabled />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!name.trim()}>
              {t("common.save")}
            </Button>
            {saved && <span className="text-sm text-muted-foreground">{t("settings.savedOk")}</span>}
          </div>
        </form>
      </Card>
      <Card title={t("settings.session")} description={t("settings.sessionDesc")}>
        <Button
          variant="secondary"
          onClick={async () => {
            await authClient.signOut();
            queryClient.clear();
            await navigate({ to: "/login" });
          }}
        >
          {t("common.signOut")}
        </Button>
      </Card>
    </div>
  );
}

function inviteLink(invitationId: string) {
  return `${window.location.origin}/invite/${invitationId}`;
}

function CopyLinkButton({ invitationId }: { invitationId: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      className="h-8 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(inviteLink(invitationId));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t("common.copied") : t("common.copy")}
    </Button>
  );
}

function Workspace() {
  const t = useT();
  const roleLabel = useRoleLabel();
  const { data: session } = authClient.useSession();
  const { data: org, refetch } = authClient.useActiveOrganization();
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRoleName>(ORG_ROLE.member);
  const [message, setMessage] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ id: string; email: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => setOrgName(org?.name ?? ""), [org?.name]);

  const myRole = org?.members.find((m) => m.userId === session?.user.id)?.role ?? ORG_ROLE.member;
  const canManage = isOrgAdmin(myRole);
  const pending = (org?.invitations ?? []).filter((i) => i.status === "pending");

  async function rename(e: FormEvent) {
    e.preventDefault();
    const result = await authClient.organization.update({ data: { name: orgName } });
    setMessage(result.error ? (result.error.message ?? t("settings.saveFailed")) : t("settings.renameSaved"));
    await refetch();
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    const result = await authClient.organization.inviteMember({ email, role });
    if (result.error) {
      setMessage(result.error.message ?? t("settings.inviteFailed"));
      return;
    }
    // Show the shareable link right away; the admin sends it through any channel.
    setMessage(null);
    setLastInvite(result.data ? { id: result.data.id, email } : null);
    setEmail("");
    await refetch();
  }

  return (
    <div className="space-y-4">
      {message && <p className="rounded-xl bg-accent px-4 py-2 text-sm">{message}</p>}
      <Card title={t("settings.workspaceName")} description={t("settings.workspaceNameDesc")}>
        <form onSubmit={rename} className="flex max-w-md gap-2">
          <Input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={!canManage}
            required
          />
          <Button type="submit" disabled={!canManage || !orgName.trim()}>
            {t("common.save")}
          </Button>
        </form>
      </Card>

      <Card title={t("settings.members", { count: org?.members.length ?? 0 })}>
        <ul className="divide-y divide-border">
          {(org?.members ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
              </div>
              {canManage && m.userId !== session?.user.id ? (
                <select
                  value={m.role}
                  onChange={async (e) => {
                    await authClient.organization.updateMemberRole({ memberId: m.id, role: e.target.value });
                    await refetch();
                  }}
                  className="h-8 rounded-lg border border-border bg-card px-2 text-xs"
                >
                  <option value={ORG_ROLE.member}>{t("common.member")}</option>
                  <option value={ORG_ROLE.admin}>{t("common.admin")}</option>
                </select>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{roleLabel(m.role)}</span>
              )}
              {canManage && m.userId !== session?.user.id && (
                <button
                  type="button"
                  aria-label={t("settings.removeAria", { name: m.user.name })}
                  onClick={() => setRemoving({ id: m.id, name: m.user.name })}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {canManage && (
        <Card title={t("settings.invite")} description={t("settings.inviteDesc")}>
          <form onSubmit={invite} className="flex flex-wrap gap-2">
            <Input
              type="email"
              placeholder={t("settings.inviteEmail")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-xs"
              required
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRoleName)}
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            >
              <option value={ORG_ROLE.member}>{t("common.member")}</option>
              <option value={ORG_ROLE.admin}>{t("common.admin")}</option>
            </select>
            <Button type="submit">
              <Mail className="size-4" /> {t("settings.inviteBtn")}
            </Button>
          </form>
          {lastInvite && (
            <div className="mt-4 rounded-xl bg-accent p-4 text-sm">
              <p>{t("settings.inviteCreated", { email: lastInvite.email })}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-2 py-1 text-xs">
                  {inviteLink(lastInvite.id)}
                </code>
                <CopyLinkButton invitationId={lastInvite.id} />
              </div>
            </div>
          )}
          {pending.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("settings.pending")}
              </p>
              <ul className="mt-1 divide-y divide-border">
                {pending.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                    <span className="text-xs text-muted-foreground">{roleLabel(inv.role)}</span>
                    <CopyLinkButton invitationId={inv.id} />
                    <Button
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={async () => {
                        await authClient.organization.cancelInvitation({ invitationId: inv.id });
                        await refetch();
                      }}
                    >
                      {t("settings.cancelInvite")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t("settings.removeTitle")}
        description={t("settings.removeBody", { name: removing?.name ?? "" })}
        confirmLabel={t("settings.remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await authClient.organization.removeMember({ memberIdOrEmail: removing.id });
          setRemoving(null);
          await refetch();
        }}
      />
    </div>
  );
}

function Shortcuts() {
  const t = useT();
  const rows = [
    [`${modKey} K`, t("shortcut.palette")],
    [`${modKey} B`, t("shortcut.sidebar")],
    [`${modKey} J`, t("shortcut.terminal")],
    [`${modKey} I`, t("shortcut.info")],
    ["Enter", t("shortcut.send")],
    ["Shift + Enter", t("shortcut.newline")],
  ];
  return (
    <Card title={t("settings.shortcuts")}>
      <ul className="divide-y divide-border">
        {rows.map(([keys, label]) => (
          <li key={keys} className="flex items-center justify-between py-2 text-sm">
            <span>{label}</span>
            <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs">{keys}</kbd>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SettingsPage() {
  const t = useT();
  const { section } = useParams({ from: "/app/settings/$section" });
  return (
    <div className="flex h-full min-h-0">
      <nav className="w-56 shrink-0 space-y-0.5 border-r border-border p-3">
        <p className="px-2 pb-2 text-sm font-semibold">{t("settings.title")}</p>
        {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
          <Link
            key={id}
            to="/settings/$section"
            params={{ section: id }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted",
              section === id && "bg-muted font-medium",
            )}
          >
            <Icon className="size-4" /> {t(label)}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl">
          {section === "appearance" && <Appearance />}
          {section === "account" && <Account />}
          {section === "workspace" && <Workspace />}
          {section === "shortcuts" && <Shortcuts />}
        </div>
      </div>
    </div>
  );
}
