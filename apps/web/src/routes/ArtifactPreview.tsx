import { downloadDocument, PREVIEW_SANDBOX, previewDocument } from "@orbs/protocol";
import { useQuery } from "@tanstack/react-query";
import { Download, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { useT } from "../i18n/index.ts";
import { CHART_LIBRARY } from "../lib/chartLib.ts";
import { orpc } from "../lib/rpc.ts";

const fileName = (title: string) =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "dashboard"
  }.html`;

/**
 * The pages the assistant made for this conversation. Their HTML is written by a model that may have read hostile text,
 * so it never runs in Orbs' own page: it runs in a frame that can only run scripts (no same-origin access, no forms, no
 * popups), under a policy that closes every network route (see `previewDocument`). The app's own policy also forbids the
 * frame from navigating anywhere but its own inline document, which blocks sending data away by changing its address.
 */
export function ArtifactPreview({
  threadId,
  expanded,
  onToggleExpanded,
}: {
  threadId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const t = useT();
  const { data: pages = [] } = useQuery(orpc.artifacts.list.queryOptions({ input: { threadId } }));
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  // A page that was just made or changed is the one to look at.
  const newest = pages[0];
  const newestKey = newest ? `${newest.id}:${newest.version}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the newest page whenever it changes
  useEffect(() => {
    setArtifactId(newest?.id ?? null);
    setVersion(null);
  }, [newestKey]);

  const current = pages.find((p) => p.id === artifactId) ?? newest;
  const shown = version ?? current?.version;
  const { data: page } = useQuery({
    ...orpc.artifacts.get.queryOptions({
      input: { artifactId: current?.id ?? "", ...(shown ? { version: shown } : {}) },
    }),
    enabled: Boolean(current),
    // A saved version never changes.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const document = useMemo(() => (page ? previewDocument(page.html, [CHART_LIBRARY]) : ""), [page]);

  if (!current) return <p className="text-muted-foreground">{t("thread.preview.empty")}</p>;

  function download() {
    if (!page) return;
    // The file keeps the page in the same locked frame, so opening it later is as safe as the preview.
    const file = downloadDocument(page.title, page.html, [CHART_LIBRARY]);
    const url = URL.createObjectURL(new Blob([file], { type: "text/html" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName(page.title);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {pages.length > 1 ? (
          <select
            value={current.id}
            onChange={(e) => {
              setArtifactId(e.target.value);
              setVersion(null);
            }}
            aria-label={t("thread.preview.which")}
            className="h-8 min-w-0 max-w-[12rem] truncate rounded-md border border-border bg-card px-2 text-xs"
          >
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium">{current.title}</span>
        )}
        {current.versions.length > 1 && (
          <select
            value={shown}
            onChange={(e) => setVersion(Number(e.target.value))}
            aria-label={t("thread.preview.versions")}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          >
            {[...current.versions].reverse().map((v) => (
              <option key={v.version} value={v.version}>
                {t("thread.preview.version", { n: v.version })}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={download} disabled={!page} title={t("thread.preview.download")}>
            <Download className="size-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={onToggleExpanded}
            title={expanded ? t("thread.preview.shrink") : t("thread.preview.expand")}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </span>
      </div>
      {page ? (
        <iframe
          // A new page, or version, is a new frame, so nothing from the previous one lingers.
          key={`${page.id}:${page.version}`}
          title={t("thread.preview.frame", { title: page.title })}
          sandbox={PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={document}
          className="min-h-[24rem] w-full flex-1 rounded-lg border border-border bg-white"
        />
      ) : (
        <div className="flex-1 rounded-lg border border-border bg-muted/40" />
      )}
      <p className="text-[11px] text-muted-foreground">{t("thread.preview.safe")}</p>
    </div>
  );
}
