import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { useT } from "../i18n/index.ts";

/** Lets a person run one allowed (read-only) action by hand and see the raw answer. */
export function ToolRunner({
  tool,
  call,
}: {
  tool: { name: string; description: string; inputSchema: Record<string, unknown> | null } | null;
  call: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<{ text: string; truncated: boolean; isError: boolean }>;
}) {
  const t = useT();
  const [args, setArgs] = useState("{}");
  const [badJson, setBadJson] = useState(false);
  const fields = tool?.inputSchema?.properties
    ? Object.keys(tool.inputSchema.properties as Record<string, unknown>)
    : [];
  const run = useMutation({
    mutationFn: (v: { tool: string; args: Record<string, unknown> }) => call(v.tool, v.args),
  });
  // A different action starts from a clean slate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the selected action changes
  useEffect(() => {
    setArgs("{}");
    setBadJson(false);
    run.reset();
  }, [tool?.name]);

  if (!tool) return <p className="text-sm text-muted-foreground">{t("conn.explore.pick")}</p>;

  function submit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || "{}");
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setBadJson(true);
      return;
    }
    setBadJson(false);
    run.mutate({ tool: tool?.name ?? "", args: parsed as Record<string, unknown> });
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="font-mono text-xs font-medium">{tool.name}</p>
      {tool.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
      {fields.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("conn.explore.hint", { fields: fields.join(", ") })}
        </p>
      )}
      <label htmlFor={`args-${tool.name}`} className="block text-xs font-medium">
        {t("conn.explore.args")}
      </label>
      <textarea
        id={`args-${tool.name}`}
        value={args}
        onChange={(e) => setArgs(e.target.value)}
        spellCheck={false}
        rows={3}
        className="w-full rounded-lg border border-border bg-card p-2 font-mono text-xs outline-none focus:border-primary"
      />
      {badJson && <p className="text-xs text-destructive">{t("conn.explore.badJson")}</p>}
      {run.error && <p className="text-xs text-destructive">{run.error.message}</p>}
      <Button onClick={submit} disabled={run.isPending}>
        {run.isPending ? t("conn.explore.running") : t("conn.explore.run")}
      </Button>
      {run.data && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("conn.explore.result")}</p>
          {run.data.isError && <p className="text-xs text-destructive">{t("conn.explore.serviceError")}</p>}
          {run.data.truncated && (
            <p className="text-xs text-muted-foreground">{t("conn.explore.truncated")}</p>
          )}
          <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap break-words">
            {run.data.text || t("conn.explore.empty")}
          </pre>
        </div>
      )}
    </div>
  );
}
