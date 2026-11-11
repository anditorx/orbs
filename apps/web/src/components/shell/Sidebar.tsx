import type { Project, Thread } from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookText,
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { orpc } from "../../lib/rpc.ts";
import { setUi } from "../../lib/uiState.ts";
import { useDeleteThread } from "../../lib/useDeleteThread.ts";
import { modKey } from "../../lib/useShortcuts.ts";
import { cn } from "../../lib/utils.ts";
import { Orb } from "../Orb.tsx";
import { ConfirmDialog } from "../ui/confirm-dialog.tsx";
import { PromptDialog } from "../ui/prompt-dialog.tsx";
import { UserMenu } from "./UserMenu.tsx";

export function useCreateThread() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation(
    orpc.threads.create.mutationOptions({
      onSuccess: async (thread) => {
        await queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
        await navigate({ to: "/t/$threadId", params: { threadId: thread.id } });
      },
    }),
  );
}

/** Pins or unpins a conversation or project for the current user, then refreshes both lists. */
function usePin() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.pins.set.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.projects.key() }),
        ]);
      },
    }),
  );
}

/** Pinned items first; the server's order (most recently updated) is kept inside each group. */
function pinnedFirst<T extends { pinned: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

interface RowActions {
  onRename: (t: Thread) => void;
  onDelete: (t: Thread) => void;
}

function ThreadRow({
  thread,
  depth = 0,
  onRename,
  onDelete,
}: { thread: Thread; depth?: number } & RowActions) {
  const t = useT();
  const pin = usePin();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  return (
    <div ref={ref} className="group relative">
      <Link
        to="/t/$threadId"
        params={{ threadId: thread.id }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className="flex items-center gap-1.5 truncate rounded-lg py-1.5 pr-8 text-sm text-foreground/85 hover:bg-muted"
        activeProps={{ className: "bg-muted font-medium text-foreground" }}
      >
        {thread.pinned && <Pin className="size-3 shrink-0 text-primary" aria-label={t("sidebar.pinned")} />}
        <span className="truncate">{thread.title}</span>
      </Link>
      <button
        type="button"
        aria-label={t("sidebar.menuFor", { title: thread.title })}
        onClick={() => setMenu((v) => !v)}
        className={cn(
          "absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground",
          menu ? "block" : "hidden group-hover:block focus:block",
        )}
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {menu && (
        <div className="absolute top-8 right-1 z-30 w-40 rounded-xl border border-border bg-card p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              pin.mutate({ kind: "thread", id: thread.id, pinned: !thread.pinned });
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
          >
            {thread.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}{" "}
            {thread.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onRename(thread);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Pencil className="size-3.5" /> {t("sidebar.rename")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onDelete(thread);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-destructive hover:bg-muted"
          >
            <Trash2 className="size-3.5" /> {t("common.delete")}
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectGroup({
  project,
  threads,
  onNewThread,
  onRenameProject,
  onDeleteProject,
  ...rowActions
}: {
  project: Project;
  threads: Thread[];
  onNewThread: (projectId: string) => void;
  onRenameProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
} & RowActions) {
  const t = useT();
  const pin = usePin();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  return (
    <div ref={ref} className="relative">
      <div className="group flex items-center rounded-lg hover:bg-muted">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm"
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <FolderClosed className="size-4 shrink-0 text-primary" />
          <span className="truncate">{project.name}</span>
        </button>
        <button
          type="button"
          aria-label={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          title={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          aria-pressed={project.pinned}
          onClick={() => pin.mutate({ kind: "project", id: project.id, pinned: !project.pinned })}
          className={cn(
            "mr-0.5 rounded-md p-1 hover:bg-card",
            project.pinned
              ? "text-primary"
              : "hidden text-muted-foreground hover:text-foreground group-hover:block",
          )}
        >
          <Pin className={cn("size-3.5", project.pinned && "fill-current")} />
        </button>
        <button
          type="button"
          aria-label={t("sidebar.newInProject", { name: project.name })}
          title={t("sidebar.newInProjectTitle")}
          onClick={() => onNewThread(project.id)}
          className="mr-1 hidden rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground group-hover:block"
        >
          <Plus className="size-3.5" />
        </button>
        {project.editable && (
          <button
            type="button"
            aria-label={t("sidebar.menuFor", { title: project.name })}
            onClick={() => setMenu((v) => !v)}
            className={cn(
              "mr-1 rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground",
              menu ? "block" : "hidden group-hover:block focus:block",
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        )}
      </div>
      {menu && (
        <div className="absolute top-8 right-1 z-30 w-44 rounded-xl border border-border bg-card p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              navigate({
                to: "/customize/$section",
                params: { section: "instructions" },
                search: { project: project.id },
              });
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
          >
            <BookText className="size-3.5" /> {t("sidebar.projectInstructions")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onRenameProject(project);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Pencil className="size-3.5" /> {t("sidebar.rename")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onDeleteProject(project);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-destructive hover:bg-muted"
          >
            <Trash2 className="size-3.5" /> {t("common.delete")}
          </button>
        </div>
      )}
      {open &&
        (threads.length > 0 ? (
          pinnedFirst(threads).map((th) => <ThreadRow key={th.id} thread={th} depth={1} {...rowActions} />)
        ) : (
          <p className="py-1 pl-9 text-xs text-muted-foreground">{t("sidebar.noneYet")}</p>
        ))}
    </div>
  );
}

export function Sidebar({ isSystemAdmin }: { isSystemAdmin: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: threads = [] } = useQuery(orpc.threads.list.queryOptions({ input: { limit: 200 } }));
  const { data: projects = [] } = useQuery(orpc.projects.list.queryOptions({ input: { mode: "work" } }));
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const rename = useMutation(
    orpc.threads.rename.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() }),
    }),
  );
  const createProject = useMutation(
    orpc.projects.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.projects.key() }),
    }),
  );
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const renameProject = useMutation(
    orpc.projects.rename.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.projects.key() }),
    }),
  );
  const deleteProject = useMutation(
    orpc.projects.delete.mutationOptions({
      onSuccess: async () => {
        // Conversations inside the project are kept; they move out of it.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.projects.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() }),
        ]);
      },
    }),
  );

  const workProjectIds = new Set(projects.map((p) => p.id));
  const looseThreads = threads.filter((th) => !th.projectId || !workProjectIds.has(th.projectId));
  const rowActions: RowActions = { onRename: setRenaming, onDelete: setDeleting };
  const newThread = (projectId?: string) =>
    createThread.mutate({
      title: t("sidebar.newChat"),
      mode: "work",
      engine: { kind: "auto" },
      ...(projectId ? { projectId } : {}),
    });

  const footerLink =
    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground/85 hover:bg-muted";

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Orb className="size-6" /> Orbs
        </Link>
        <button
          type="button"
          onClick={() => setUi({ sidebarOpen: false })}
          aria-label={t("shell.hideSidebar")}
          title={t("shell.hideSidebarTitle", { key: modKey })}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="space-y-1 px-3 pb-2">
        <button
          type="button"
          onClick={() => newThread()}
          className="flex w-full items-center gap-2 rounded-lg bg-card px-2.5 py-2 text-sm font-medium shadow-sm ring-1 ring-border hover:bg-accent"
        >
          <MessageSquarePlus className="size-4 text-primary" /> {t("sidebar.newChat")}
        </button>
        <button
          type="button"
          onClick={() => setUi({ paletteOpen: true })}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <Search className="size-4" /> {t("shell.search")}
          <kbd className="ml-auto rounded border border-border px-1.5 text-[10px]">{modKey}K</kbd>
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2">
        <section>
          <div className="flex items-center justify-between px-2 pb-1">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t("sidebar.projects")}
            </p>
            <button
              type="button"
              aria-label={t("sidebar.newProject")}
              title={t("sidebar.newProject")}
              onClick={() => setNewProject(true)}
              className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FolderPlus className="size-3.5" />
            </button>
          </div>
          {projects.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">{t("sidebar.projectsHint")}</p>
          )}
          {pinnedFirst(projects).map((p) => (
            <ProjectGroup
              key={p.id}
              project={p}
              threads={threads.filter((th) => th.projectId === p.id)}
              onNewThread={newThread}
              onRenameProject={setRenamingProject}
              onDeleteProject={setDeletingProject}
              {...rowActions}
            />
          ))}
        </section>

        <section className="border-t border-border pt-4">
          <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("sidebar.conversations")}
          </p>
          {pinnedFirst(looseThreads).map((th) => (
            <ThreadRow key={th.id} thread={th} {...rowActions} />
          ))}
          {looseThreads.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">{t("sidebar.noConversations")}</p>
          )}
        </section>
      </nav>

      <div className="space-y-0.5 border-t border-border px-3 py-2">
        <Link to="/customize/$section" params={{ section: "skills" }} className={footerLink}>
          <Wand2 className="size-4" /> {t("sidebar.customize")}
        </Link>
        <Link to="/usage" className={footerLink}>
          <BarChart3 className="size-4" /> {t("sidebar.usage")}
        </Link>
        <Link to="/settings/$section" params={{ section: "appearance" }} className={footerLink}>
          <SlidersHorizontal className="size-4" /> {t("sidebar.settings")}
        </Link>
        {isSystemAdmin && (
          <Link to="/admin" className={footerLink}>
            <ShieldCheck className="size-4" /> {t("sidebar.systemAdmin")}
          </Link>
        )}
      </div>
      <UserMenu />

      <PromptDialog
        open={renaming !== null}
        title={t("sidebar.renameTitle")}
        label={t("sidebar.renameLabel")}
        initialValue={renaming?.title ?? ""}
        onCancel={() => setRenaming(null)}
        onSubmit={(title) => {
          if (renaming) rename.mutate({ threadId: renaming.id, title });
          setRenaming(null);
        }}
      />
      <PromptDialog
        open={newProject}
        title={t("sidebar.newProject")}
        label={t("sidebar.newProjectLabel")}
        confirmLabel={t("common.create")}
        onCancel={() => setNewProject(false)}
        onSubmit={(name) => {
          createProject.mutate({ name, mode: "work" });
          setNewProject(false);
        }}
      />
      <PromptDialog
        open={renamingProject !== null}
        title={t("sidebar.renameProjectTitle")}
        label={t("sidebar.renameProjectLabel")}
        initialValue={renamingProject?.name ?? ""}
        onCancel={() => setRenamingProject(null)}
        onSubmit={(name) => {
          if (renamingProject) renameProject.mutate({ projectId: renamingProject.id, name });
          setRenamingProject(null);
        }}
      />
      <ConfirmDialog
        open={deletingProject !== null}
        title={t("sidebar.deleteProjectTitle")}
        description={t("sidebar.deleteProjectBody", { name: deletingProject?.name ?? "" })}
        busy={deleteProject.isPending}
        onCancel={() => setDeletingProject(null)}
        onConfirm={() => {
          if (deletingProject)
            deleteProject.mutate(
              { projectId: deletingProject.id },
              { onSettled: () => setDeletingProject(null) },
            );
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t("sidebar.deleteTitle")}
        description={t("sidebar.deleteBody", { title: deleting?.title ?? "" })}
        busy={deleteThread.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting)
            deleteThread.mutate({ threadId: deleting.id }, { onSettled: () => setDeleting(null) });
        }}
      />
    </aside>
  );
}
