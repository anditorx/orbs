import { isSystemAdmin } from "@orbs/protocol";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Orb } from "../components/Orb.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { useT } from "../i18n/index.ts";
import { authClient } from "../lib/auth.ts";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function OnboardingPage() {
  const t = useT();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  // Companies are created by Orbs system administrators; everyone else joins by invitation.
  const canCreate = isSystemAdmin((session?.user as { role?: string | null } | undefined)?.role);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const slug = `${slugify(name) || "org"}-${Math.random().toString(36).slice(2, 6)}`;
    const created = await authClient.organization.create({ name, slug });
    if (created.error || !created.data) {
      setBusy(false);
      setError(created.error?.message ?? t("onboarding.createFailed"));
      return;
    }
    await authClient.organization.setActive({ organizationId: created.data.id });
    setBusy(false);
    await navigate({ to: "/" });
  }

  if (isPending) return null;
  if (!canCreate) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted p-6">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <Orb />
          <h1 className="text-xl font-semibold">{t("onboarding.noWorkspaceTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("onboarding.noWorkspaceBody")}</p>
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              await authClient.signOut();
              await navigate({ to: "/login" });
            }}
          >
            {t("common.signOut")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm"
      >
        <Orb />
        <h1 className="text-xl font-semibold">{t("onboarding.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("onboarding.body")}</p>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t("onboarding.invited")}
        </p>
        <Input
          placeholder={t("onboarding.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
          {t("onboarding.create")}
        </Button>
      </form>
    </div>
  );
}
