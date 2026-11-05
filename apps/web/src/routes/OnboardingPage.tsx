import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Orb } from "../components/Orb.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { authClient } from "../lib/auth.ts";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function OnboardingPage() {
  const navigate = useNavigate();
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
      setError(created.error?.message ?? "Gagal membuat organisasi.");
      return;
    }
    await authClient.organization.setActive({ organizationId: created.data.id });
    setBusy(false);
    await navigate({ to: "/" });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm"
      >
        <Orb />
        <h1 className="text-xl font-semibold">Buat ruang kerja tim</h1>
        <p className="text-sm text-muted-foreground">
          Ruang kerja menyimpan percakapan, plugin, dan koneksi tim kamu. Semua data tersimpan di server
          perusahaanmu sendiri.
        </p>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Diundang ke ruang kerja yang sudah ada? Buka <b>tautan undangan</b> dari admin timmu.
        </p>
        <Input
          placeholder="Nama perusahaan atau tim"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
          Buat ruang kerja
        </Button>
      </form>
    </div>
  );
}
