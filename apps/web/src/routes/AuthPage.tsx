import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Orb } from "../components/Orb.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { useT } from "../i18n/index.ts";
import { authClient } from "../lib/auth.ts";

/** Sign in / sign up. With `invitationId` the user arrived from an invite link (/invite/<id>). */
export function AuthPage({ invitationId }: { invitationId?: string } = {}) {
  const t = useT();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(invitationId ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const inviteHeaders = invitationId ? { headers: { "x-orbs-invitation": invitationId } } : undefined;
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ name, email, password }, inviteHeaders)
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? t("auth.failed"));
      return;
    }
    if (invitationId) {
      // The invite page now sees a session and offers to join the workspace.
      window.location.reload();
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    <div className="flex h-full items-center justify-center bg-muted p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <Orb />
          <div>
            <h1 className="text-lg font-semibold">Orbs</h1>
            <p className="text-sm text-muted-foreground">
              {invitationId ? t("auth.taglineInvite") : t("auth.tagline")}
            </p>
          </div>
        </div>
        {mode === "signup" && (
          <Input
            placeholder={t("auth.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <Input
          type="email"
          placeholder={t("auth.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder={t("auth.password")}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "signup" ? t("auth.signUp") : t("auth.signIn")}
        </Button>
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? t("auth.noAccount") : t("auth.haveAccount")}
        </button>
      </form>
    </div>
  );
}
