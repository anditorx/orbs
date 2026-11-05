import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Bot, FileCode, FolderUp, Loader2, SquareTerminal, Trash2, Upload, X } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "../components/FileTree.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import {
  fromDataTransfer,
  fromFileList,
  type PickedFolder,
  type UploadProgress,
  uploadToProject,
} from "../lib/folderUpload.ts";
import { orpc, rpc } from "../lib/rpc.ts";
import { setUi, useUi } from "../lib/uiState.ts";
import { modKey, useShortcuts } from "../lib/useShortcuts.ts";
import { cn } from "../lib/utils.ts";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const reasonLabel: Record<string, string> = {
  "ignored-directory": "folder dependensi/build",
  "secret-or-system-file": "file rahasia/sistem (mis. .env)",
  "invalid-path": "nama/path tidak valid",
  "too-large": "terlalu besar",
  "project-quota": "melebihi kuota proyek",
};

function FileViewer({ projectId, path }: { projectId: string; path: string }) {
  const { data, isLoading } = useQuery(orpc.projects.readFile.queryOptions({ input: { projectId, path } }));
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat…</p>;
  if (!data) return null;
  if (data.binary) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        File biner ({formatBytes(data.size)}) — tidak bisa ditampilkan.
      </p>
    );
  }
  const lines = (data.content ?? "").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {data.truncated && (
        <p className="border-b border-border bg-muted px-4 py-1 text-xs text-muted-foreground">
          File besar ({formatBytes(data.size)}) — hanya 1 MB pertama yang ditampilkan.
        </p>
      )}
      <pre className="font-mono text-[13px] leading-5">
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and never reordered
          <div key={i} className="flex hover:bg-muted/60">
            <span className="w-12 shrink-0 select-none pr-3 text-right text-muted-foreground/70">
              {i + 1}
            </span>
            <span className="pr-4 whitespace-pre">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function CodeMode() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ from: "/app/code" });
  const { data: projects = [] } = useQuery(orpc.projects.list.queryOptions({ input: { mode: "code" } }));
  const projectId = search.project ?? projects[0]?.id;
  const project = projects.find((p) => p.id === projectId);
  const { data: files = [] } = useQuery({
    ...orpc.projects.files.queryOptions({ input: { projectId: projectId ?? "" } }),
    enabled: Boolean(projectId),
  });

  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<"new" | "current">("new");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const terminalOpen = useUi((s) => s.terminalOpen);
  const shortcuts = useMemo(() => ({ "mod+j": () => setUi((s) => ({ terminalOpen: !s.terminalOpen })) }), []);
  useShortcuts(shortcuts);

  // Chromium needs the non-standard attribute to let users pick a whole folder.
  useEffect(() => {
    input.current?.setAttribute("webkitdirectory", "");
  }, []);

  const select = (next: { project?: string; file?: string }) =>
    navigate({ to: "/code", search: { project: next.project, file: next.file } });

  const deleteProject = useMutation(
    orpc.projects.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
        await select({});
      },
    }),
  );

  async function upload(folder: PickedFolder) {
    setReport(null);
    if (folder.files.length === 0) {
      setReport("Tidak ada file yang bisa diunggah dari folder ini.");
      return;
    }
    try {
      const destination =
        target === "current" && projectId
          ? projectId
          : (await rpc.projects.create({ name: folder.rootName, mode: "code" })).id;
      const result = await uploadToProject(destination, folder.files, setProgress);
      const skippedTotal = folder.skipped + result.skipped.length;
      const reasons = [...new Set(result.skipped.map((s) => reasonLabel[s.reason] ?? s.reason))];
      setReport(
        `${result.saved} file diunggah` +
          (skippedTotal > 0
            ? `, ${skippedTotal} dilewati (${reasons.length ? reasons.join(", ") : "node_modules, .git, .env, build"})`
            : "") +
          ".",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
      await select({ project: destination });
    } catch (error) {
      setReport(`Gagal mengunggah: ${error instanceof Error ? error.message : "kesalahan tidak dikenal"}`);
    } finally {
      setProgress(null);
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const folder = await fromDataTransfer(e.dataTransfer.items);
    if (folder) await upload(folder);
    else setReport("Seret sebuah folder (bukan file satuan).");
  }

  const pick = (where: "new" | "current") => {
    setTarget(where);
    input.current?.click();
  };

  return (
    <div className="grid h-full grid-cols-[260px_1fr_300px] overflow-hidden">
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(fromFileList(e.target.files));
          e.target.value = "";
        }}
      />
      <aside
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("flex min-h-0 flex-col border-r border-border bg-muted/40", dragging && "bg-accent")}
      >
        <div className="space-y-2 border-b border-border p-3">
          <select
            value={projectId ?? ""}
            onChange={(e) => select({ project: e.target.value || undefined })}
            className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
          >
            {projects.length === 0 && <option value="">Belum ada proyek</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button className="w-full" onClick={() => pick("new")} disabled={progress !== null}>
            <FolderUp className="size-4" /> Unggah folder proyek
          </Button>
          {project && (
            <div className="flex gap-1">
              <Button
                variant="secondary"
                className="h-8 flex-1 text-xs"
                onClick={() => pick("current")}
                disabled={progress !== null}
              >
                <Upload className="size-3.5" /> Tambah ke proyek ini
              </Button>
              <Button
                variant="secondary"
                className="h-8 px-2 text-xs text-destructive"
                aria-label="Hapus proyek"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
          {progress && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Mengunggah {progress.done}/{progress.total} file…
              </p>
            </div>
          )}
          {report && <p className="text-xs text-muted-foreground">{report}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {project ? (
            <>
              <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {project.fileCount} file · {formatBytes(project.totalBytes)}
              </p>
              <FileTree
                entries={files}
                selected={search.file}
                onSelect={(file) => select({ project: projectId, file })}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Seret folder proyek ke sini, atau klik <b>Unggah folder proyek</b>. Folder seperti{" "}
              <code>node_modules</code>, <code>.git</code> dan file <code>.env</code> otomatis dilewati.
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-10 items-center border-b border-border px-4 text-sm">
          <FileCode className="mr-2 size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{search.file ?? "Pilih file untuk dilihat"}</span>
          <button
            type="button"
            onClick={() => setUi((s) => ({ terminalOpen: !s.terminalOpen }))}
            title={`Terminal (${modKey}J)`}
            aria-label="Terminal"
            className={cn(
              "rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
              terminalOpen && "bg-muted text-foreground",
            )}
          >
            <SquareTerminal className="size-4" />
          </button>
        </header>
        {projectId && search.file ? (
          <FileViewer projectId={projectId} path={search.file} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Editor, diff dan terminal hadir di Fase 5. Saat ini kamu bisa mengunggah dan menelusuri file
            proyek.
          </div>
        )}
      </section>

      <aside className="border-l border-border p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Bot className="size-4" /> AGENT CODING
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Di Fase 5 agent bisa membaca proyek ini, mengusulkan perubahan, dan menjalankan test di sandbox.
        </p>
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        title="Hapus proyek?"
        description={`Proyek "${project?.name ?? ""}" dan semua file yang diunggah akan dihapus permanen dari server.`}
        busy={deleteProject.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          projectId && deleteProject.mutate({ projectId }, { onSettled: () => setConfirmDelete(false) })
        }
      />
    </div>
  );
}
