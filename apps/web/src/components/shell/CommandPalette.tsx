import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
  Code2,
  FolderClosed,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  PanelLeft,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../i18n/index.ts";
import { orpc } from "../../lib/rpc.ts";
import { useTheme } from "../../lib/theme.ts";
import { setUi, useUi } from "../../lib/uiState.ts";
import { modKey } from "../../lib/useShortcuts.ts";
import { useCreateThread } from "./Sidebar.tsx";

function Item({
  icon,
  children,
  hint,
  onSelect,
  value,
}: {
  icon: ReactNode;
  children: ReactNode;
  hint?: string;
  onSelect: () => void;
  value: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <kbd className="text-[11px] text-muted-foreground">{hint}</kbd>}
    </Command.Item>
  );
}

const groupClass =
  "px-1 py-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground";

/** ⌘K: jump to any conversation or project, or run a command. */
export function CommandPalette({ isSystemAdmin }: { isSystemAdmin: boolean }) {
  const t = useT();
  const open = useUi((s) => s.paletteOpen);
  const navigate = useNavigate();
  const { toggleDark } = useTheme();
  const createThread = useCreateThread();
  const { data: threads = [] } = useQuery({
    ...orpc.threads.list.queryOptions({ input: { limit: 200 } }),
    enabled: open,
  });
  const { data: projects = [] } = useQuery({
    ...orpc.projects.list.queryOptions({ input: {} }),
    enabled: open,
  });

  const close = () => setUi({ paletteOpen: false });
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(value) => setUi({ paletteOpen: value })}
      label={t("palette.label")}
      overlayClassName="fixed inset-0 z-40 bg-black/30"
      contentClassName="fixed top-[15%] left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl"
    >
      <Command.Input
        placeholder={t("palette.placeholder")}
        className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none"
      />
      <Command.List className="max-h-[60vh] overflow-y-auto p-1">
        <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t("palette.empty")}
        </Command.Empty>
        <Command.Group heading={t("palette.actions")} className={groupClass}>
          <Item
            value="percakapan baru new conversation new chat"
            icon={<MessageSquarePlus className="size-4" />}
            onSelect={run(() =>
              createThread.mutate({ title: t("sidebar.newChat"), mode: "work", engine: { kind: "auto" } }),
            )}
          >
            {t("palette.newChat")}
          </Item>
          <Item
            value="mode kerja work open work"
            icon={<Sparkles className="size-4" />}
            onSelect={run(() => navigate({ to: "/" }))}
          >
            {t("palette.openWork")}
          </Item>
          <Item
            value="mode kode code ide open code"
            icon={<Code2 className="size-4" />}
            onSelect={run(() => navigate({ to: "/code", search: {} }))}
          >
            {t("palette.openCode")}
          </Item>
          <Item
            value="tema gelap terang dark light theme"
            icon={<Moon className="size-4" />}
            onSelect={run(toggleDark)}
          >
            {t("palette.toggleTheme")}
          </Item>
          <Item
            value="sidebar tampilkan sembunyikan"
            icon={<PanelLeft className="size-4" />}
            hint={`${modKey}B`}
            onSelect={run(() => setUi((s) => ({ sidebarOpen: !s.sidebarOpen })))}
          >
            {t("palette.toggleSidebar")}
          </Item>
          <Item
            value="kustomisasi skills mcp plugin instructions"
            icon={<Wand2 className="size-4" />}
            onSelect={run(() => navigate({ to: "/customize/$section", params: { section: "skills" } }))}
          >
            {t("palette.customize")}
          </Item>
          <Item
            value="pengaturan settings preferences language bahasa"
            icon={<SlidersHorizontal className="size-4" />}
            onSelect={run(() => navigate({ to: "/settings/$section", params: { section: "appearance" } }))}
          >
            {t("palette.settings")}
          </Item>
          {isSystemAdmin && (
            <Item
              value="admin sistem superadmin"
              icon={<ShieldCheck className="size-4" />}
              onSelect={run(() => navigate({ to: "/admin" }))}
            >
              {t("palette.systemAdmin")}
            </Item>
          )}
        </Command.Group>
        {projects.length > 0 && (
          <Command.Group heading={t("palette.projects")} className={groupClass}>
            {projects.map((p) => (
              <Item
                key={p.id}
                value={`proyek ${p.name} ${p.id}`}
                icon={<FolderClosed className="size-4" />}
                hint={p.mode === "code" ? t("shell.code") : t("shell.work")}
                onSelect={run(() =>
                  p.mode === "code"
                    ? navigate({ to: "/code", search: { project: p.id } })
                    : navigate({ to: "/" }),
                )}
              >
                {p.name}
              </Item>
            ))}
          </Command.Group>
        )}
        {threads.length > 0 && (
          <Command.Group heading={t("palette.conversations")} className={groupClass}>
            {threads.map((th) => (
              <Item
                key={th.id}
                value={`percakapan conversation ${th.title} ${th.id}`}
                icon={<MessageSquare className="size-4" />}
                onSelect={run(() => navigate({ to: "/t/$threadId", params: { threadId: th.id } }))}
              >
                {th.title}
              </Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
