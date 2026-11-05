import {
  type AdminUser,
  isSystemAdmin,
  ORG_ROLE,
  ORG_ROLE_LABEL,
  type OrgRoleName,
  SYSTEM_ROLE,
  type SystemRole,
} from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Building2, ScrollText, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Orb } from "../components/Orb.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { PromptDialog } from "../components/ui/prompt-dialog.tsx";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";

type Tab = "overview" | "users" | "orgs" | "audit";

const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "overview", label: "Ringkasan", icon: ShieldCheck },
  { id: "users", label: "Pengguna", icon: Users },
  { id: "orgs", label: "Organisasi", icon: Building2 },
  { id: "audit", label: "Log audit", icon: ScrollText },
];

const signupModeLabel = {
  open: "Terbuka — siapa pun bisa mendaftar",
  "invite-only": "Hanya lewat undangan",
  domain: "Hanya domain email tertentu",
} as const;

function formatDate(value: string) {
  return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
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
  const { data } = useQuery(orpc.admin.overview.queryOptions());
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pengguna" value={data.users} />
        <Stat label="Administrator sistem" value={data.admins} />
        <Stat label="Organisasi" value={data.organizations} />
        <Stat label="Percakapan" value={data.threads} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-medium">Kebijakan pendaftaran</h3>
        <p className="mt-1 text-sm">{signupModeLabel[data.signupMode]}</p>
        {data.signupDomains.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">Domain: {data.signupDomains.join(", ")}</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Diatur lewat <code>ORBS_SIGNUP_MODE</code> dan <code>ORBS_SIGNUP_DOMAINS</code> di file{" "}
          <code>.env</code> server.
        </p>
      </div>
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<SystemRole>(SYSTEM_ROLE.user);
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
    create.mutate({ name, email, password, role });
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2"
    >
      <Input placeholder="Nama lengkap" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        type="password"
        placeholder="Kata sandi awal (min. 8 karakter)"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as SystemRole)}
        className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
      >
        <option value="user">Pengguna biasa</option>
        <option value={SYSTEM_ROLE.admin}>Administrator sistem</option>
      </select>
      {create.error && <p className="text-sm text-destructive sm:col-span-2">{create.error.message}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={create.isPending}>
          Tambah pengguna
        </Button>
      </div>
    </form>
  );
}

type PendingAction = { kind: "ban" | "unban" | "make-admin" | "remove-admin"; user: AdminUser };

const actionCopy: Record<
  PendingAction["kind"],
  { title: string; confirm: string; describe: (u: AdminUser) => string }
> = {
  ban: {
    title: "Blokir pengguna?",
    confirm: "Blokir",
    describe: (u) => `${u.name} tidak akan bisa masuk dan semua sesinya akan diakhiri.`,
  },
  unban: { title: "Buka blokir?", confirm: "Buka blokir", describe: (u) => `${u.name} bisa masuk kembali.` },
  "make-admin": {
    title: "Jadikan administrator sistem?",
    confirm: "Jadikan admin",
    describe: (u) => `${u.name} akan bisa mengelola semua pengguna dan organisasi di instalasi ini.`,
  },
  "remove-admin": {
    title: "Cabut peran administrator?",
    confirm: "Cabut",
    describe: (u) => `${u.name} akan menjadi pengguna biasa.`,
  },
};

function UsersTab() {
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
          placeholder="Cari nama atau email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={() => setCreating(true)} className="ml-auto">
          <UserPlus className="size-4" /> Tambah pengguna
        </Button>
      </div>
      {creating && <CreateUserForm onDone={() => setCreating(false)} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Pengguna</th>
              <th className="px-4 py-3 font-medium">Peran</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Organisasi</th>
              <th className="px-4 py-3 font-medium">Bergabung</th>
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
                      {u.name} {isSelf && <span className="text-xs text-muted-foreground">(kamu)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        isSystemAdmin(u.role) ? "bg-accent text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isSystemAdmin(u.role) ? "Admin sistem" : "Pengguna"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.banned ? <span className="text-destructive">Diblokir</span> : <span>Aktif</span>}
                  </td>
                  <td className="px-4 py-3">{u.orgCount}</td>
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
                          {isSystemAdmin(u.role) ? "Cabut admin" : "Jadikan admin"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => setEditing({ kind: "password", user: u })}
                        >
                          Password
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => setEditing({ kind: "email", user: u })}
                        >
                          Email
                        </Button>
                        <Button
                          variant="ghost"
                          className={cn("h-8 text-xs", !u.banned && "text-destructive")}
                          onClick={() => setPending({ kind: u.banned ? "unban" : "ban", user: u })}
                        >
                          {u.banned ? "Buka blokir" : "Blokir"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 text-xs text-destructive"
                          onClick={() => setDeleting(u)}
                        >
                          Hapus
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
            ? `Password baru untuk ${editing.user.name}`
            : `Email baru untuk ${editing?.user.name ?? ""}`
        }
        label={editing?.kind === "password" ? "Password baru (min. 8 karakter)" : "Email baru"}
        inputType={editing?.kind === "password" ? "password" : "email"}
        confirmLabel="Simpan"
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
        title="Hapus akun?"
        description={`${deleting?.name ?? ""} (${deleting?.email ?? ""}) dihapus permanen. Riwayat biaya tetap tersimpan. Untuk menonaktifkan sementara, gunakan Blokir.`}
        confirmLabel="Hapus akun"
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          deleting && remove.mutate({ userId: deleting.id }, { onSettled: () => setDeleting(null) })
        }
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? actionCopy[pending.kind].title : ""}
        description={pending ? actionCopy[pending.kind].describe(pending.user) : ""}
        confirmLabel={pending ? actionCopy[pending.kind].confirm : ""}
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
            Masuk ke perusahaan
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Sebagai admin sistem kamu bisa mengelola perusahaan ini tanpa menjadi anggotanya. Isi percakapan
        anggota tetap pribadi dan tidak bisa dibuka. Semua tindakan di sini tercatat di log audit.
      </p>

      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          rename.mutate({ orgId, name: name.trim() || org.name });
        }}
      >
        <Input
          placeholder={`Ganti nama (sekarang: ${org.name})`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={!name.trim() || rename.isPending}>
          Ganti nama
        </Button>
      </form>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Anggota ({org.members.length})</h4>
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
                <option value={ORG_ROLE.member}>{ORG_ROLE_LABEL[ORG_ROLE.member]}</option>
                <option value={ORG_ROLE.admin}>{ORG_ROLE_LABEL[ORG_ROLE.admin]}</option>
              </select>
              <button
                type="button"
                aria-label={`Keluarkan ${m.name}`}
                onClick={() => setRemoving({ memberId: m.memberId, name: m.name })}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {org.members.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted-foreground">Belum ada anggota.</li>
          )}
        </ul>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Undang anggota</h4>
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
            placeholder="email@perusahaan.co.id"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRoleName)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value={ORG_ROLE.member}>Anggota</option>
            <option value={ORG_ROLE.admin}>Admin</option>
          </select>
          <Button type="submit" disabled={invite.isPending}>
            Undang
          </Button>
        </form>
        {lastInvite && (
          <p className="mt-2 rounded-lg bg-accent px-3 py-2 text-xs break-all">
            Tautan undangan: <b>{lastInvite}</b>
          </p>
        )}
        {org.invitations.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {org.invitations.map((i) => (
              <li key={i.id}>
                {i.email} · {ORG_ROLE_LABEL[i.role] ?? i.role} · berlaku sampai {formatDate(i.expiresAt)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <Button className="bg-destructive text-white" onClick={() => setDeleting(true)}>
          Hapus perusahaan
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          Menghapus semua data perusahaan ini (percakapan, proyek, file, batas). Tidak bisa dibatalkan.
        </p>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="Keluarkan anggota?"
        description={`${removing?.name ?? ""} tidak lagi bisa mengakses perusahaan ini. Percakapannya tetap tersimpan.`}
        confirmLabel="Keluarkan"
        busy={removeMember.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          removeMember.mutate({ orgId, memberId: removing.memberId }, { onSettled: () => setRemoving(null) })
        }
      />
      <PromptDialog
        open={deleting}
        title={`Hapus ${org.name}?`}
        label="Ketik nama perusahaan untuk konfirmasi"
        confirmLabel="Hapus permanen"
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
  const { data: orgs = [] } = useQuery(orpc.admin.orgs.list.queryOptions());
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Organisasi</th>
              <th className="px-4 py-3 font-medium">Anggota</th>
              <th className="px-4 py-3 font-medium">Percakapan</th>
              <th className="px-4 py-3 font-medium">Token bulan ini</th>
              <th className="px-4 py-3 font-medium">Biaya bulan ini</th>
              <th className="px-4 py-3 font-medium">Dibuat</th>
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
                <td className="px-4 py-3">{Math.round(o.monthTokens).toLocaleString("id-ID")}</td>
                <td className="px-4 py-3">Rp {Math.round(o.monthCostIdr).toLocaleString("id-ID")}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(o.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" className="h-8 text-xs" onClick={() => setSelected(o.id)}>
                    Kelola
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

const auditLabel: Record<string, string> = {
  "thread.delete": "Menghapus percakapan",
  "project.upload": "Mengunggah file proyek",
  "project.delete": "Menghapus proyek",
  "system.user.create": "Membuat pengguna",
  "system.user.set-role": "Mengubah peran sistem",
  "system.user.ban": "Memblokir pengguna",
  "system.user.unban": "Membuka blokir pengguna",
  "system.user.set-password": "Mengubah password pengguna",
  "system.user.set-email": "Mengubah email pengguna",
  "system.user.delete": "Menghapus akun",
  "system.org.rename": "Mengganti nama perusahaan",
  "system.org.delete": "Menghapus perusahaan",
  "system.org.enter": "Masuk ke perusahaan",
  "system.org.invite": "Mengundang anggota (admin sistem)",
  "system.org.set-member-role": "Mengubah peran anggota (admin sistem)",
  "system.org.remove-member": "Mengeluarkan anggota (admin sistem)",
  "usage.reset": "Mereset kuota",
  "budget.set": "Mengatur batas pemakaian",
  "budget.delete": "Menghapus batas pemakaian",
  "system.role.promote": "Menjadikan admin (CLI)",
  "system.role.demote": "Mencabut admin (CLI)",
};

function AuditTab() {
  const { data: entries = [] } = useQuery(orpc.admin.audit.list.queryOptions({ input: { limit: 200 } }));
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Waktu</th>
            <th className="px-4 py-3 font-medium">Aksi</th>
            <th className="px-4 py-3 font-medium">Pelaku</th>
            <th className="px-4 py-3 font-medium">Organisasi</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(e.createdAt)}</td>
              <td className="px-4 py-3">{auditLabel[e.action] ?? e.action}</td>
              <td className="px-4 py-3">{e.actorEmail ?? "Sistem / CLI"}</td>
              <td className="px-4 py-3">{e.orgName ?? "—"}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                Belum ada aktivitas tercatat.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="min-h-full bg-muted/40">
      <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
        <Link to="/" className="rounded-lg p-2 hover:bg-muted" aria-label="Kembali ke Orbs">
          <ArrowLeft className="size-4" />
        </Link>
        <Orb className="size-6" />
        <span className="font-semibold">Admin Sistem</span>
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
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        {tab === "overview" && <Overview />}
        {tab === "users" && <UsersTab />}
        {tab === "orgs" && <OrgsTab />}
        {tab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}
