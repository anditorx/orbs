import {
  type Customization,
  type CustomizationInput,
  type CustomizationKind,
  isOrgAdmin,
} from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  Blocks,
  BookText,
  Globe,
  type LucideIcon,
  Pencil,
  Plug,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";

interface Section {
  id: "instructions" | "skills" | "mcp" | "plugins";
  label: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  bullets: string[];
  phase: string;
}

export const CUSTOMIZE_SECTIONS: Section[] = [
  {
    id: "instructions",
    label: "Instruksi",
    icon: BookText,
    title: "Instruksi untuk agent",
    summary:
      "Aturan yang selalu dibaca agent: gaya bahasa, konteks perusahaan, hal yang wajib atau dilarang.",
    bullets: [
      "Instruksi pribadi (hanya untukmu) dan instruksi ruang kerja (untuk semua anggota).",
      "Instruksi per proyek, misalnya istilah khusus klien atau standar kode tim.",
      "Format Markdown biasa, bisa diimpor dari AGENTS.md yang sudah ada.",
    ],
    phase: "Fase 1",
  },
  {
    id: "skills",
    label: "Skill",
    icon: Sparkles,
    title: "Skill",
    summary:
      "Keahlian siap pakai yang bisa dipanggil agent: misalnya ‘buat laporan mingguan’ atau ‘tulis PRD’. Memakai format SKILL.md yang terbuka.",
    bullets: [
      "Buat skill lewat chat (‘buatkan skill untuk…’) atau lewat formulir sederhana.",
      "Impor skill yang sudah ada dari folder skills tool lain.",
      "Bagikan ke tim setelah ditinjau admin.",
    ],
    phase: "Fase 3",
  },
  {
    id: "mcp",
    label: "Koneksi (MCP)",
    icon: Plug,
    title: "Koneksi ke aplikasi lain",
    summary:
      "Hubungkan GitHub, Jira, Slack, Google Drive, database internal, dan lainnya lewat MCP — cukup klik ‘Hubungkan’ lalu login.",
    bullets: [
      "Login sekali (OAuth). Kunci akses disimpan terenkripsi di server, tidak pernah dikirim ke agent.",
      "Admin bisa menyiapkan koneksi bersama untuk seluruh tim.",
      "Setiap pemakaian tercatat di log audit.",
    ],
    phase: "Fase 2",
  },
  {
    id: "plugins",
    label: "Plugin",
    icon: Blocks,
    title: "Plugin tim",
    summary:
      "Paket berisi agent, skill, alur kerja dan koneksi — contohnya ‘SDLC Agent’ (analis → arsitek → developer → QA → deploy dengan persetujuan).",
    bullets: [
      "Katalog plugin ruang kerja: pasang dengan satu klik.",
      "Terbitkan plugin buatanmu ke tim; admin meninjau izin yang diminta dalam bahasa sederhana.",
      "Versi, pembaruan, dan rollback.",
    ],
    phase: "Fase 3",
  },
];

const EDITABLE_KINDS: Record<string, { kind: CustomizationKind; noun: string; template: string }> = {
  instructions: {
    kind: "instruction",
    noun: "instruksi",
    template:
      "Selalu jawab dalam Bahasa Indonesia yang ringkas.\nGunakan istilah teknis dalam bahasa Inggris bila lebih umum.",
  },
  skills: {
    kind: "skill",
    noun: "skill",
    template:
      "---\nname: laporan-mingguan\ndescription: Menyusun laporan mingguan dari catatan kerja\n---\n\n# Langkah\n1. Kumpulkan pencapaian minggu ini.\n2. Tulis ringkasan 3 poin.\n3. Tambahkan risiko dan rencana minggu depan.",
  },
  plugins: {
    kind: "plugin",
    noun: "plugin",
    template: JSON.stringify(
      {
        name: "contoh-plugin",
        version: "1.0.0",
        displayName: "Contoh Plugin",
        description: "Paket skill untuk tim.",
        permissions: { connectors: [], shell: false, network: false },
        skills: [],
      },
      null,
      2,
    ),
  },
};

function CustomizationEditor({
  noun,
  kind,
  template,
  initial,
  isAdmin,
  onClose,
}: {
  noun: string;
  kind: CustomizationKind;
  template: string;
  initial: Customization | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: projects } = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? template);
  const [scope, setScope] = useState<"user" | "org">(initial?.scope ?? "user");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const onSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.customizations.key() });
    onClose();
  };
  const create = useMutation(orpc.customizations.create.mutationOptions({ onSuccess }));
  const update = useMutation(orpc.customizations.update.mutationOptions({ onSuccess }));
  const error = create.error ?? update.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    const fields: Omit<CustomizationInput, "kind"> = {
      scope,
      projectId: projectId || null,
      name,
      description,
      body,
      enabled,
    };
    if (initial) update.mutate({ id: initial.id, patch: fields });
    else create.mutate({ kind, ...fields });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-primary/40 bg-card p-5">
      <h2 className="font-semibold">
        {initial ? `Ubah ${noun}` : `${noun[0]?.toUpperCase()}${noun.slice(1)} baru`}
      </h2>
      <Input
        placeholder="Nama"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
      />
      <Input
        placeholder="Deskripsi singkat (opsional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        spellCheck={false}
        aria-label={kind === "plugin" ? "Manifest plugin (JSON)" : "Isi (Markdown)"}
        className="w-full rounded-lg border border-border bg-card p-3 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Berlaku di
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">Global (semua proyek)</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                Hanya proyek {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Pemilik
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "user" | "org")}
            disabled={!isAdmin && scope === "user"}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="user">Pribadi (hanya saya)</option>
            {isAdmin && <option value="org">Seluruh ruang kerja</option>}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Aktif
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

function CustomizationManager({ sectionId, summary }: { sectionId: string; summary: string }) {
  const cfg = EDITABLE_KINDS[sectionId];
  const queryClient = useQueryClient();
  const { data: me } = useQuery(orpc.me.queryOptions());
  const isAdmin = isOrgAdmin(me?.role);
  const { data: items } = useQuery({
    ...orpc.customizations.list.queryOptions({ input: { kind: cfg?.kind } }),
    enabled: Boolean(cfg),
  });
  const [editing, setEditing] = useState<Customization | "new" | null>(null);
  const [deleting, setDeleting] = useState<Customization | null>(null);
  const remove = useMutation(
    orpc.customizations.delete.mutationOptions({
      onSuccess: async () => {
        setDeleting(null);
        await queryClient.invalidateQueries({ queryKey: orpc.customizations.key() });
      },
    }),
  );
  const toggle = useMutation(
    orpc.customizations.update.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.customizations.key() }),
    }),
  );
  if (!cfg) return null;
  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{summary}</p>
        <Button onClick={() => setEditing("new")} className="shrink-0">
          <Plus className="size-4" /> Baru
        </Button>
      </div>
      {editing && (
        <CustomizationEditor
          key={editing === "new" ? "new" : editing.id}
          noun={cfg.noun}
          kind={cfg.kind}
          template={cfg.template}
          initial={editing === "new" ? null : editing}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
        />
      )}
      {items?.length === 0 && !editing && (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Belum ada {cfg.noun}. Klik “Baru” untuk membuat.
        </p>
      )}
      <ul className="space-y-2">
        {items?.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.name}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {item.scope === "org" ? <Users className="size-3" /> : null}
                  {item.scope === "org" ? "Ruang kerja" : "Pribadi"}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Globe className="size-3" /> {item.projectName ? `Proyek ${item.projectName}` : "Global"}
                </span>
                {!item.enabled && <span className="text-xs text-muted-foreground">nonaktif</span>}
              </div>
              {item.description && <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                v{item.version}
                {item.ownerName ? ` · oleh ${item.ownerName}` : ""}
              </p>
            </div>
            {item.editable && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: item.id, patch: { enabled: !item.enabled } })}
                  className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  {item.enabled ? "Nonaktifkan" : "Aktifkan"}
                </button>
                <button
                  type="button"
                  aria-label={`Ubah ${item.name}`}
                  onClick={() => setEditing(item)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Hapus ${item.name}`}
                  onClick={() => setDeleting(item)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        title={`Hapus ${cfg.noun}?`}
        description={`“${deleting?.name ?? ""}” akan dihapus permanen.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

export function CustomizePage() {
  const { section } = useParams({ from: "/app/customize/$section" });
  const current = CUSTOMIZE_SECTIONS.find((s) => s.id === section) ?? CUSTOMIZE_SECTIONS[1];
  if (!current) return null;
  const Icon = current.icon;
  const editable = current.id in EDITABLE_KINDS;
  return (
    <div className="flex h-full min-h-0">
      <nav className="w-56 shrink-0 space-y-0.5 border-r border-border p-3">
        <p className="px-2 pb-2 text-sm font-semibold">Kustomisasi</p>
        {CUSTOMIZE_SECTIONS.map(({ id, label, icon: ItemIcon }) => (
          <Link
            key={id}
            to="/customize/$section"
            params={{ section: id }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted",
              current.id === id && "bg-muted font-medium",
            )}
          >
            <ItemIcon className="size-4" /> {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
              <Icon className="size-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold">{current.title}</h1>
              {!editable && (
                <span className="text-xs text-muted-foreground">Segera hadir · {current.phase}</span>
              )}
            </div>
          </div>
          {editable ? (
            <>
              <CustomizationManager sectionId={current.id} summary={current.summary} />
              <p className="mt-6 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Item ini sudah bisa dibuat, diubah, dan dihapus. Agent akan membacanya setelah agent engine
                aktif (Fase Agent).
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-muted-foreground">{current.summary}</p>
              <ul className="mt-6 space-y-2">
                {current.bullets.map((b) => (
                  <li key={b} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                    {b}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
