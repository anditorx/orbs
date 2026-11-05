import { isSystemAdmin } from "@orbs/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronsUpDown, LogOut, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { authClient } from "../../lib/auth.ts";
import { orpc } from "../../lib/rpc.ts";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Bottom-of-sidebar menu: who you are, which workspace is active, sign out. */
export function UserMenu() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useQuery(orpc.me.queryOptions());
  const { data: session } = authClient.useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: orgsData } = authClient.useListOrganizations();
  const orgs = orgsData ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function switchOrg(organizationId: string) {
    setOpen(false);
    await authClient.organization.setActive({ organizationId });
    queryClient.clear();
    await navigate({ to: "/" });
  }

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: "/login" });
  }

  const name = session?.user.name ?? "";
  return (
    <div ref={ref} className="relative border-t border-border p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-muted"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials(name) || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {activeOrg?.name ?? me?.activeOrgName ?? "—"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-14 left-2 z-30 w-60 rounded-xl border border-border bg-card p-1 shadow-lg">
          <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("menu.workspaces")}
          </p>
          {orgs.map((org) => (
            <button
              type="button"
              key={org.id}
              onClick={() => switchOrg(org.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span className="truncate">{org.name}</span>
              {org.id === activeOrg?.id && <Check className="ml-auto size-4 text-primary" />}
            </button>
          ))}
          {isSystemAdmin((session?.user as { role?: string | null } | undefined)?.role) && (
            <Link
              to="/onboarding"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              <Plus className="size-4" /> {t("menu.newWorkspace")}
            </Link>
          )}
          <div className="my-1 border-t border-border" />
          <Link
            to="/settings/$section"
            params={{ section: "account" }}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
          >
            <SlidersHorizontal className="size-4" /> {t("menu.accountSettings")}
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-destructive hover:bg-muted"
          >
            <LogOut className="size-4" /> {t("common.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
