import type { ActiveInstructions } from "@orbs/protocol";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookText } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";
import { Dialog } from "./ui/dialog.tsx";

const TIERS = ["org", "project", "user"] as const;

function Item({ item }: { item: ActiveInstructions["items"][number] }) {
  const t = useT();
  return (
    <li className="rounded-lg border border-border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{item.name}</span>
        {item.tier !== "user" && item.ownerName && (
          <span className="text-xs text-muted-foreground">{t("reader.by", { name: item.ownerName })}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{item.chars}</span>
      </div>
      {item.tier === "project" && item.projectNames.length > 0 && (
        <p className="text-xs text-muted-foreground">{item.projectNames.join(", ")}</p>
      )}
      {item.fit !== "whole" && (
        <p className="mt-1 text-xs text-destructive">
          {item.fit === "cut" ? t("reader.cut") : t("reader.leftOut")}
        </p>
      )}
    </li>
  );
}

/** What the assistant reads from the saved instructions, grouped by who wrote them, with the exact text on request. */
function Contents({ data }: { data: ActiveInstructions }) {
  const t = useT();
  if (data.items.length === 0) {
    return <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">{t("reader.empty")}</p>;
  }
  return (
    <div className="space-y-4">
      {TIERS.map((tier) => {
        const items = data.items.filter((i) => i.tier === tier);
        if (items.length === 0) return null;
        const usage = data.usage.find((u) => u.tier === tier);
        return (
          <section key={tier} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t(`reader.tier.${tier}`)}
              </h3>
              {usage && (
                <span className="text-xs text-muted-foreground">
                  {t("reader.usage", { used: usage.used, limit: usage.limit })}
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {items.map((item) => (
                <Item key={item.id} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">{t("reader.authority")}</p>
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm">{t("reader.showText")}</summary>
        <pre className="max-h-64 overflow-auto border-t border-border p-3 text-xs whitespace-pre-wrap">
          {data.text}
        </pre>
      </details>
    </div>
  );
}

/**
 * A window showing what the assistant reads from the saved instructions. For a conversation (`threadId`) it shows what
 * applies there; otherwise the person can pick a project (or none) to see what would apply.
 */
export function InstructionsReader({
  open,
  onClose,
  threadId,
  initialProjectId = null,
}: {
  open: boolean;
  onClose: () => void;
  threadId?: string;
  initialProjectId?: string | null;
}) {
  const t = useT();
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const { data: projects = [] } = useQuery({
    ...orpc.projects.list.queryOptions({ input: {} }),
    enabled: open && !threadId,
  });
  const { data, isPending, error } = useQuery({
    ...orpc.customizations.active.queryOptions({ input: threadId ? { threadId } : { projectId } }),
    enabled: open,
  });
  return (
    <Dialog open={open} onClose={onClose} title={t("reader.title")}>
      <div className="space-y-4">
        {threadId ? (
          <p className="text-sm text-muted-foreground">
            {data?.projectName ? t("reader.inProject", { name: data.projectName }) : t("reader.thisChat")}
          </p>
        ) : (
          <label className="block space-y-1 text-xs text-muted-foreground">
            {t("reader.where")}
            <select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value || null)}
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
            >
              <option value="">{t("reader.noProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("reader.inProject", { name: p.name })}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {isPending && !error && <p className="text-sm text-muted-foreground">…</p>}
        {data && <Contents data={data} />}
        <div className="flex justify-end">
          <Link
            to="/customize/$section"
            params={{ section: "instructions" }}
            search={data?.projectId ? { project: data.projectId } : {}}
            onClick={onClose}
            className="text-sm text-primary hover:underline"
          >
            {t("reader.manage")}
          </Link>
        </div>
      </div>
    </Dialog>
  );
}

/** The small button in a conversation's header: how many instructions apply, and opens what the assistant reads. */
export function InstructionsChip({ threadId }: { threadId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data } = useQuery(orpc.customizations.active.queryOptions({ input: { threadId } }));
  const count = data?.items.length ?? 0;
  const problem = data?.items.some((i) => i.fit !== "whole") ?? false;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("reader.chipTitle")}
        aria-label={t("reader.chip", { count })}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
          problem && "text-destructive",
        )}
      >
        <BookText className="size-4" />
        {count}
      </button>
      <InstructionsReader open={open} onClose={() => setOpen(false)} threadId={threadId} />
    </>
  );
}
