import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n/index.ts";
import { Button } from "./button.tsx";

/** A read-only value with a Copy button. */
export function CopyField({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{value}</code>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard can be blocked; the address stays selectable.
          }
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t("connAdmin.copied") : t("connAdmin.copy")}
      </Button>
    </div>
  );
}
