import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { Orb } from "../components/Orb.tsx";
import { Button } from "../components/ui/button.tsx";
import { useT } from "../i18n/index.ts";
import { authClient } from "../lib/auth.ts";
import { AuthPage } from "./AuthPage.tsx";

/**
 * Landing page of an invitation link. The invitation id is an unguessable secret shared by an
 * admin (chat, email, ...); the server also checks that the signed-in email matches the invite.
 */
export function InvitePage() {
  const t = useT();
  const { invitationId } = useParams({ from: "/invite/$invitationId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isPending) return null;
  if (!session) return <AuthPage invitationId={invitationId} />;

  async function accept() {
    setBusy(true);
    setError(null);
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error || !result.data) {
      setBusy(false);
      const code = (result.error as { code?: string } | null)?.code;
      setError(
        code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION"
          ? t("invite.wrongRecipient", { email: session?.user.email ?? "" })
          : t("invite.invalid"),
      );
      return;
    }
    await authClient.organization.setActive({ organizationId: result.data.invitation.organizationId });
    queryClient.clear();
    await navigate({ to: "/" });
  }

  async function switchAccount() {
    await authClient.signOut();
    queryClient.clear();
    window.location.reload();
  }

  return (
    <div className="flex h-full items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
        <Orb />
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <MailCheck className="size-5 text-primary" /> {t("invite.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("invite.body", { email: session.user.email })}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={accept} disabled={busy} className="flex-1">
            {t("invite.join")}
          </Button>
          <Button variant="secondary" onClick={switchAccount}>
            {t("invite.switch")}
          </Button>
        </div>
      </div>
    </div>
  );
}
