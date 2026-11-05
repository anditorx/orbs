import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Code2, Moon, PanelLeftOpen, Search, Sparkles, Sun } from "lucide-react";
import { useMemo } from "react";
import { CommandPalette } from "../components/shell/CommandPalette.tsx";
import { Sidebar } from "../components/shell/Sidebar.tsx";
import { useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { useTheme } from "../lib/theme.ts";
import { setUi, useUi } from "../lib/uiState.ts";
import { useLiveEvents } from "../lib/useLiveEvents.ts";
import { modKey, useShortcuts } from "../lib/useShortcuts.ts";
import { cn } from "../lib/utils.ts";

function ModeSwitch() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isCode = pathname.startsWith("/code");
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition";
  return (
    <div className="flex rounded-full bg-muted p-1">
      <Link to="/" className={cn(base, !isCode ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
        <Sparkles className="size-4" /> {t("shell.work")}
      </Link>
      <Link
        to="/code"
        search={{}}
        className={cn(base, isCode ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}
      >
        <Code2 className="size-4" /> {t("shell.code")}
      </Link>
    </div>
  );
}

export function AppShell() {
  const t = useT();
  const { data: me } = useQuery(orpc.me.queryOptions());
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const { toggleDark } = useTheme();
  const isDark = document.documentElement.classList.contains("dark");
  useLiveEvents(true);

  const shortcuts = useMemo(
    () => ({
      "mod+k": () => setUi((s) => ({ paletteOpen: !s.paletteOpen })),
      "mod+b": () => setUi((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    [],
  );
  useShortcuts(shortcuts);

  return (
    <div className="flex h-full">
      {sidebarOpen && <Sidebar isSystemAdmin={Boolean(me?.isSystemAdmin)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setUi({ sidebarOpen: true })}
                aria-label={t("shell.showSidebar")}
                title={t("shell.showSidebarTitle", { key: modKey })}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            )}
          </div>
          <ModeSwitch />
          <div className="flex flex-1 items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setUi({ paletteOpen: true })}
              className="hidden items-center gap-2 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted md:inline-flex"
            >
              <Search className="size-3.5" /> {t("shell.search")} <kbd>{modKey}K</kbd>
            </button>
            <button
              type="button"
              onClick={toggleDark}
              aria-label={t("shell.toggleTheme")}
              title={t("shell.toggleTheme")}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
      <CommandPalette isSystemAdmin={Boolean(me?.isSystemAdmin)} />
    </div>
  );
}
