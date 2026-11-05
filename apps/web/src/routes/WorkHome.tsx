import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText, GitBranch, ListChecks, Mail } from "lucide-react";
import { useT } from "../i18n/index.ts";
import { authClient } from "../lib/auth.ts";
import { orpc } from "../lib/rpc.ts";

const templates = [
  { icon: FileText, title: "home.t1.title", hint: "home.t1.hint" },
  { icon: Mail, title: "home.t2.title", hint: "home.t2.hint" },
  { icon: ListChecks, title: "home.t3.title", hint: "home.t3.hint" },
  { icon: GitBranch, title: "home.t4.title", hint: "home.t4.hint" },
] as const;

export function WorkHome() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const create = useMutation(
    orpc.threads.create.mutationOptions({
      onSuccess: async (thread) => {
        await queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
        await navigate({ to: "/t/$threadId", params: { threadId: thread.id } });
      },
    }),
  );
  const firstName = session?.user.name.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        {firstName ? t("home.greetingName", { name: firstName }) : t("home.greeting")} 👋
      </h1>
      <p className="mt-2 text-muted-foreground">{t("home.prompt")}</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {templates.map(({ icon: Icon, title, hint }) => (
          <button
            type="button"
            key={title}
            disabled={create.isPending}
            onClick={() => create.mutate({ title: t(title), mode: "work", engine: { kind: "auto" } })}
            className="rounded-2xl border border-border bg-card p-5 text-left transition hover:border-primary hover:shadow-sm"
          >
            <Icon className="size-5 text-primary" />
            <p className="mt-3 font-medium">{t(title)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t(hint)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
