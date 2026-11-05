import { Link, useParams } from "@tanstack/react-router";
import { Blocks, BookText, type LucideIcon, Plug, Sparkles } from "lucide-react";
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

export function CustomizePage() {
  const { section } = useParams({ from: "/app/customize/$section" });
  const current = CUSTOMIZE_SECTIONS.find((s) => s.id === section) ?? CUSTOMIZE_SECTIONS[1];
  if (!current) return null;
  const Icon = current.icon;
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
              <span className="text-xs text-muted-foreground">Segera hadir · {current.phase}</span>
            </div>
          </div>
          <p className="mt-4 text-muted-foreground">{current.summary}</p>
          <ul className="mt-6 space-y-2">
            {current.bullets.map((b) => (
              <li key={b} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
