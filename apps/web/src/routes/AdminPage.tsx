import {
  type AdminUser,
  isOrgAdmin,
  isSystemAdmin,
  ORG_ROLE,
  type OrgRoleName,
  SYSTEM_ROLE,
} from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Building2, Cpu, ScrollText, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Orb } from "../components/Orb.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { PromptDialog } from "../components/ui/prompt-dialog.tsx";
import { getLang, localeOf, type MessageKey, useRoleLabel, useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";
import { ModelsTab } from "./AdminModels.tsx";

type Tab = "overview" | "users" | "orgs" | "models" | "audit";

const tabs: Array<{ id: Tab; label: MessageKey; icon: typeof Users }> = [
  { id: "overview", label: "admin.tab.overview", icon: ShieldCheck },
  { id: "users", label: "admin.tab.users", icon: Users },
  { id: "orgs", label: "admin.tab.orgs", icon: Building2 },
  { id: "models", label: "admin.tab.models", icon: Cpu },
  { id: "audit", label: "admin.tab.audit", icon: ScrollText },
];

const signupModeLabel = {
  open: "admin.signup.open",
  "invite-only": "admin.signup.invite-only",
  domain: "admin.signup.domain",
} as const;

function formatDate(value: string) {
  return new Date(value).toLocaleString(localeOf(getLang()), { dateStyle: "medium", timeStyle: "short" });
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Overview() {
  const t = useT();
  const { data } = useQuery(orpc.admin.overview.queryOptions());
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("admin.stat.users")} value={data.users} />
        <Stat label={t("admin.stat.admins")} value={data.admins} />
        <Stat label={t("admin.stat.orgs")} value={data.organizations} />
        <Stat label={t("admin.stat.threads")} value={data.threads} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-medium">{t("admin.signupPolicy")}</h3>
        <p className="mt-1 text-sm">{t(signupModeLabel[data.signupMode])}</p>
        {data.signupDomains.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("admin.domains", { domains: data.signupDomains.join(", ") })}
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("admin.signupNote", { mode: "ORBS_SIGNUP_MODE", domains: "ORBS_SIGNUP_DOMAINS" })}
        </p>
      </div>
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // One choice covers every role: system admin, or admin/member of a company.
  const [role, setRole] = useState<AccountRole>(ORG_ROLE.member);
  const [orgId, setOrgId] = useState("");
  const { data: orgs = [] } = useQuery(orpc.admin.orgs.list.queryOptions());
  const needsOrg = role !== SYSTEM_ROLE.admin;
  const create = useMutation(
    orpc.admin.users.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
        onDone();
      },
    }),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (role === SYSTEM_ROLE.admin) create.mutate({ name, email, password, role: SYSTEM_ROLE.admin });
    else create.mutate({ name, email, password, role: SYSTEM_ROLE.user, orgId, orgRole: role });
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2"
    >
      <Input
        placeholder={t("admin.user.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Input
        type="email"
        placeholder={t("admin.user.email")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        type="password"
        placeholder={t("admin.user.password")}
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as AccountRole)}
        aria-label={t("admin.user.role")}
        className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
      >
        <option value={ORG_ROLE.member}>{t("admin.user.roleMember")}</option>
        <option value={ORG_ROLE.admin}>{t("admin.user.roleAdmin")}</option>
        <option value={SYSTEM_ROLE.admin}>{t("admin.user.roleSystem")}</option>
      </select>
      {needsOrg && (
        <select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          aria-label={t("admin.user.organization")}
          required
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm sm:col-span-2"
        >
          <option value="">
            {orgs.length === 0 ? t("admin.user.createOrganizationFirst") : t("admin.user.pickOrganization")}
          </option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {create.error && <p className="text-sm text-destructive sm:col-span-2">{create.error.message}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending || (needsOrg && !orgId)}>
          {t("admin.user.add")}
        </Button>
      </div>
    </form>
  );
}

type AccountRole = typeof SYSTEM_ROLE.admin | OrgRoleName;

type PendingAction = { kind: "ban" | "unban" | "make-admin" | "remove-admin"; user: AdminUser };

const actionCopy: Record<
  PendingAction["kind"],
  { title: MessageKey; confirm: MessageKey; body: MessageKey }
> = {
  ban: {
    title: "admin.action.ban.title",
    confirm: "admin.action.ban.confirm",
    body: "admin.action.ban.body",
  },
  unban: {
    title: "admin.action.unban.title",
    confirm: "admin.action.unban.confirm",
    body: "admin.action.unban.body",
  },
  "make-admin": {
    title: "admin.action.makeAdmin.title",
    confirm: "admin.action.makeAdmin.confirm",
    body: "admin.action.makeAdmin.body",
  },
  "remove-admin": {
    title: "admin.action.removeAdmin.title",
    confirm: "admin.action.removeAdmin.confirm",
    body: "admin.action.removeAdmin.body",
  },
};

/** Badges for the "Role" column: the system role, plus every distinct organization role the account holds. */
function roleBadges(u: AdminUser): Array<{ label: MessageKey; system: boolean }> {
  const badges: Array<{ label: MessageKey; system: boolean }> = [];
  if (isSystemAdmin(u.role)) badges.push({ label: "admin.user.roleSystemBadge", system: true });
  if (u.orgs.some((o) => isOrgAdmin(o.role)))
    badges.push({ label: "admin.user.roleOrgAdminBadge", system: false });
  if (u.orgs.some((o) => !isOrgAdmin(o.role)))
    badges.push({ label: "admin.user.roleOrgMemberBadge", system: false });
  if (badges.length === 0) badges.push({ label: "admin.user.roleUserBadge", system: false });
  return badges;
}

function UsersTab() {
  const t = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [editing, setEditing] = useState<{ kind: "password" | "email"; user: AdminUser } | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: me } = useQuery(orpc.me.queryOptions());
  const { data: users = [] } = useQuery(
    orpc.admin.users.list.queryOptions({ input: search.trim() ? { search: search.trim() } : {} }),
  );
  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  const options = { onSuccess: invalidate, onError: (e: Error) => setError(e.message) };
  const ban = useMutation(orpc.admin.users.ban.mutationOptions(options));
  const unban = useMutation(orpc.admin.users.unban.mutationOptions(options));
  const setRole = useMutation(orpc.admin.users.setRole.mutationOptions(options));
  const setPassword = useMutation(orpc.admin.users.setPassword.mutationOptions(options));
  const setEmail = useMutation(orpc.admin.users.setEmail.mutationOptions(options));
  const remove = useMutation(orpc.admin.users.delete.mutationOptions(options));
  const busy = ban.isPending || unban.isPending || setRole.isPending;

  function confirm() {
    if (!pending) return;
    setError(null);
    const userId = pending.user.id;
    const done = { onSettled: () => setPending(null) };
    if (pending.kind === "ban") ban.mutate({ userId }, done);
    if (pending.kind === "unban") unban.mutate({ userId }, done);
    if (pending.kind === "make-admin") setRole.mutate({ userId, role: SYSTEM_ROLE.admin }, done);
    if (pending.kind === "remove-admin") setRole.mutate({ userId, role: SYSTEM_ROLE.user }, done);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t("admin.user.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={() => setCreating(true)} className="ml-auto">
          <UserPlus className="size-4" /> {t("admin.user.add")}
        </Button>
      </div>
      {creating && <CreateUserForm onDone={() => setCreating(false)} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t("admin.user.col.user")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.user.col.role")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.user.col.status")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.user.col.orgs")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.user.col.joined")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === me?.user.id;
              return (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {u.name}{" "}
                      {isSelf && <span className="text-xs text-muted-foreground">{t("common.you")}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {roleBadges(u).map((badge) => (
                        <span
                          key={badge.label}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
                            badge.system ? "bg-accent text-primary" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {t(badge.label)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.banned ? (
                      <span className="text-destructive">{t("common.blocked")}</span>
                    ) : (
                      <span>{t("common.active")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.orgs.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      u.orgs.map((o) => o.name).join(", ")
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {!isSelf && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() =>
                            setPending({
                              kind: isSystemAdmin(u.role) ? "remove-admin" : "make-admin",
                              user: u,
                            })
                          }
                        >
                          {isSystemAdmin(u.role) ? t("admin.user.revokeAdmin") : t("admin.user.makeAdmin")}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => setEditing({ kind: "password", user: u })}
                        >
                          {t("admin.user.password.btn")}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => setEditing({ kind: "email", user: u })}
                        >
                          {t("admin.user.email.btn")}
                        </Button>
                        <Button
                          variant="ghost"
                          className={cn("h-8 text-xs", !u.banned && "text-destructive")}
                          onClick={() => setPending({ kind: u.banned ? "unban" : "ban", user: u })}
                        >
                          {u.banned ? t("admin.user.unblock") : t("admin.user.block")}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 text-xs text-destructive"
                          onClick={() => setDeleting(u)}
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PromptDialog
        open={editing !== null}
        title={
          editing?.kind === "password"
            ? t("admin.user.passwordTitle", { name: editing.user.name })
            : t("admin.user.emailTitle", { name: editing?.user.name ?? "" })
        }
        label={editing?.kind === "password" ? t("admin.user.passwordLabel") : t("admin.user.emailLabel")}
        inputType={editing?.kind === "password" ? "password" : "email"}
        confirmLabel={t("common.save")}
        onCancel={() => setEditing(null)}
        onSubmit={(value) => {
          if (!editing) return;
          setError(null);
          const done = { onSettled: () => setEditing(null) };
          if (editing.kind === "password")
            setPassword.mutate({ userId: editing.user.id, password: value }, done);
          else setEmail.mutate({ userId: editing.user.id, email: value }, done);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t("admin.user.deleteTitle")}
        description={t("admin.user.deleteBody", { name: deleting?.name ?? "", email: deleting?.email ?? "" })}
        confirmLabel={t("admin.user.deleteConfirm")}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          deleting && remove.mutate({ userId: deleting.id }, { onSettled: () => setDeleting(null) })
        }
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? t(actionCopy[pending.kind].title) : ""}
        description={pending ? t(actionCopy[pending.kind].body, { name: pending.user.name }) : ""}
        confirmLabel={pending ? t(actionCopy[pending.kind].confirm) : ""}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </div>
  );
}

function inviteUrl(id: string) {
  return `${window.location.origin}/invite/${id}`;
}

function OrgManager({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const t = useT();
  const roleLabel = useRoleLabel();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: org } = useQuery(orpc.admin.orgs.detail.queryOptions({ input: { orgId } }));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRoleName>(ORG_ROLE.member);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ memberId: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  const options = { onSuccess: refresh, onError: (e: Error) => setError(e.message) };
  const rename = useMutation(orpc.admin.orgs.rename.mutationOptions(options));
  const invite = useMutation(
    orpc.admin.orgs.invite.mutationOptions({
      ...options,
      onSuccess: async (result) => {
        setLastInvite(inviteUrl(result.invitationId));
        setEmail("");
        await refresh();
      },
    }),
  );
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });
  const [newUserRole, setNewUserRole] = useState<OrgRoleName>(ORG_ROLE.member);
  const createUser = useMutation(
    orpc.admin.users.create.mutationOptions({
      ...options,
      onSuccess: async () => {
        setNewUser({ name: "", email: "", password: "" });
        await refresh();
      },
    }),
  );
  const setMemberRole = useMutation(orpc.admin.orgs.setMemberRole.mutationOptions(options));
  const removeMember = useMutation(orpc.admin.orgs.removeMember.mutationOptions(options));
  const deleteOrg = useMutation(
    orpc.admin.orgs.delete.mutationOptions({
      onError: (e: Error) => setError(e.message),
      onSuccess: async () => {
        setDeleting(false);
        await queryClient.invalidateQueries();
        onClose();
      },
    }),
  );
  const enter = useMutation(
    orpc.admin.orgs.enter.mutationOptions({
      onError: (e: Error) => setError(e.message),
      onSuccess: async () => {
        queryClient.clear();
        await navigate({ to: "/" });
      },
    }),
  );
  if (!org) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-primary/40 bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{org.name}</h3>
        <span className="text-xs text-muted-foreground">{org.slug}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => enter.mutate({ orgId })} disabled={enter.isPending}>
            {t("admin.org.enter")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t("admin.org.godNote")}</p>

      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          rename.mutate({ orgId, name: name.trim() || org.name });
        }}
      >
        <Input
          placeholder={t("admin.org.renamePlaceholder", { name: org.name })}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={!name.trim() || rename.isPending}>
          {t("admin.org.rename")}
        </Button>
      </form>

      <div>
        <h4 className="mb-2 text-sm font-semibold">
          {t("admin.org.members", { count: org.members.length })}
        </h4>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {org.members.map((m) => (
            <li key={m.memberId} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              <select
                value={m.role}
                onChange={(e) => {
                  setError(null);
                  setMemberRole.mutate({ orgId, memberId: m.memberId, role: e.target.value as OrgRoleName });
                }}
                className="h-8 rounded-lg border border-border bg-card px-2 text-xs"
              >
                <option value={ORG_ROLE.member}>{t("common.member")}</option>
                <option value={ORG_ROLE.admin}>{t("common.admin")}</option>
              </select>
              <button
                type="button"
                aria-label={t("admin.org.removeAria", { name: m.name })}
                onClick={() => setRemoving({ memberId: m.memberId, name: m.name })}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {org.members.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted-foreground">{t("admin.org.noMembers")}</li>
          )}
        </ul>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("admin.org.createUser")}</h4>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            createUser.mutate({
              ...newUser,
              role: SYSTEM_ROLE.user,
              orgId,
              orgRole: newUserRole,
            });
          }}
        >
          <Input
            placeholder={t("admin.user.name")}
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            required
          />
          <Input
            type="email"
            placeholder={t("admin.user.email")}
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            required
          />
          <Input
            type="password"
            minLength={8}
            placeholder={t("admin.user.password")}
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            required
          />
          <select
            value={newUserRole}
            onChange={(e) => setNewUserRole(e.target.value as OrgRoleName)}
            aria-label={t("admin.org.roleInOrganization")}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value={ORG_ROLE.member}>{t("admin.org.roleMemberOpt")}</option>
            <option value={ORG_ROLE.admin}>{t("admin.org.roleAdminOpt")}</option>
          </select>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={createUser.isPending}>
              {t("admin.org.createUserBtn")}
            </Button>
          </div>
        </form>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("admin.org.invite")}</h4>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            invite.mutate({ orgId, email, role });
          }}
        >
          <Input
            type="email"
            className="max-w-xs"
            placeholder={t("settings.inviteEmail")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          <Button type="submit" disabled={invite.isPending}>
            {t("admin.org.inviteBtn")}
          </Button>
        </form>
        {lastInvite && (
          <p className="mt-2 rounded-lg bg-accent px-3 py-2 text-xs break-all">
            {t("admin.org.inviteLink")} <b>{lastInvite}</b>
          </p>
        )}
        {org.invitations.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {org.invitations.map((i) => (
              <li key={i.id}>
                {t("admin.org.inviteRow", {
                  email: i.email,
                  role: roleLabel(i.role),
                  date: formatDate(i.expiresAt),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <Button className="bg-destructive text-white" onClick={() => setDeleting(true)}>
          {t("admin.org.delete")}
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.org.deleteNote")}</p>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={t("admin.org.removeTitle")}
        description={t("admin.org.removeBody", { name: removing?.name ?? "" })}
        confirmLabel={t("admin.org.remove")}
        busy={removeMember.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          removeMember.mutate({ orgId, memberId: removing.memberId }, { onSettled: () => setRemoving(null) })
        }
      />
      <PromptDialog
        open={deleting}
        title={t("admin.org.deleteTitle", { name: org.name })}
        label={t("admin.org.deleteLabel")}
        confirmLabel={t("admin.org.deleteConfirm")}
        onCancel={() => setDeleting(false)}
        onSubmit={(confirmName) => {
          setError(null);
          deleteOrg.mutate({ orgId, confirmName });
        }}
      />
    </div>
  );
}

function OrgsTab() {
  const t = useT();
  const { data: orgs = [] } = useQuery(orpc.admin.orgs.list.queryOptions());
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createOrg = useMutation(
    orpc.admin.orgs.create.mutationOptions({
      onError: (e: Error) => setCreateError(e.message),
      onSuccess: async (result) => {
        setCreating(false);
        await queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
        setSelected(result.id);
      },
    }),
  );
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Building2 className="size-4" /> {t("admin.org.create")}
        </Button>
      </div>
      {createError && <p className="text-sm text-destructive">{createError}</p>}
      <PromptDialog
        open={creating}
        title={t("admin.org.createTitle")}
        label={t("admin.org.nameLabel")}
        confirmLabel={t("common.create")}
        onCancel={() => setCreating(false)}
        onSubmit={(name) => {
          setCreateError(null);
          createOrg.mutate({ name });
        }}
      />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t("admin.org.col.org")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.org.col.members")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.org.col.threads")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.org.col.tokens")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.org.col.cost")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.org.col.created")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{o.name}</p>
                  <p className="text-xs text-muted-foreground">{o.slug}</p>
                </td>
                <td className="px-4 py-3">{o.memberCount}</td>
                <td className="px-4 py-3">{o.threadCount}</td>
                <td className="px-4 py-3">{Math.round(o.monthTokens).toLocaleString(localeOf(getLang()))}</td>
                <td className="px-4 py-3">
                  Rp {Math.round(o.monthCostIdr).toLocaleString(localeOf(getLang()))}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(o.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" className="h-8 text-xs" onClick={() => setSelected(o.id)}>
                    {t("admin.org.manage")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <OrgManager key={selected} orgId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Known audit actions have a translation under "audit.<action>"; unknown ones show their raw code. */
function auditLabelOf(t: (key: MessageKey) => string, action: string) {
  const key = `audit.${action}` as MessageKey;
  const label = t(key);
  return label === key ? action : label;
}

function AuditTab() {
  const t = useT();
  const { data: entries = [] } = useQuery(orpc.admin.audit.list.queryOptions({ input: { limit: 200 } }));
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t("admin.audit.time")}</th>
            <th className="px-4 py-3 font-medium">{t("admin.audit.action")}</th>
            <th className="px-4 py-3 font-medium">{t("admin.audit.actor")}</th>
            <th className="px-4 py-3 font-medium">{t("admin.audit.org")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(e.createdAt)}</td>
              <td className="px-4 py-3">{auditLabelOf(t, e.action)}</td>
              <td className="px-4 py-3">{e.actorEmail ?? t("admin.audit.system")}</td>
              <td className="px-4 py-3">{e.orgName ?? "—"}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                {t("admin.audit.empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="min-h-full bg-muted/40">
      <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
        <Link to="/" className="rounded-lg p-2 hover:bg-muted" aria-label={t("admin.back")}>
          <ArrowLeft className="size-4" />
        </Link>
        <Orb className="size-6" />
        <span className="font-semibold">{t("admin.title")}</span>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <nav className="mb-6 flex flex-wrap gap-2">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm",
                tab === id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:bg-card",
              )}
            >
              <Icon className="size-4" /> {t(label)}
            </button>
          ))}
        </nav>
        {tab === "overview" && <Overview />}
        {tab === "users" && <UsersTab />}
        {tab === "orgs" && <OrgsTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}
