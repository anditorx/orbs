import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText, GitBranch, ListChecks, Mail } from "lucide-react";
import { authClient } from "../lib/auth.ts";
import { orpc } from "../lib/rpc.ts";

const templates = [
  { icon: FileText, title: "Rangkum dokumen", hint: "Unggah atau tempel dokumen, dapatkan poin pentingnya." },
  { icon: Mail, title: "Balas email pelanggan", hint: "Draf balasan yang sopan dan jelas, siap diedit." },
  { icon: ListChecks, title: "Buat laporan mingguan", hint: "Kumpulkan progres tim jadi laporan rapi." },
  {
    icon: GitBranch,
    title: "Mulai proyek software (SDLC)",
    hint: "Dari ide → kebutuhan → desain → kode → QA.",
  },
];

export function WorkHome() {
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
      <h1 className="text-3xl font-semibold tracking-tight">Halo{firstName ? `, ${firstName}` : ""} 👋</h1>
      <p className="mt-2 text-muted-foreground">
        Mau dibantu apa hari ini? Pilih salah satu atau mulai percakapan baru.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {templates.map(({ icon: Icon, title, hint }) => (
          <button
            type="button"
            key={title}
            disabled={create.isPending}
            onClick={() => create.mutate({ title, mode: "work", engine: { kind: "auto" } })}
            className="rounded-2xl border border-border bg-card p-5 text-left transition hover:border-primary hover:shadow-sm"
          >
            <Icon className="size-5 text-primary" />
            <p className="mt-3 font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
