import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { Input } from "./input.tsx";

/** A field for a secret: hidden by default, with an eye to look at what was typed or pasted. */
export function SecretInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className={`pr-10 ${className ?? ""}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? t("secret.hide") : t("secret.show")}
        aria-pressed={shown}
        title={shown ? t("secret.hide") : t("secret.show")}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
