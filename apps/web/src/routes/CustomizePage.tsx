import {
  type AppliesTo,
  appliesHere,
  type Customization,
  type CustomizationInput,
  type CustomizationKind,
  instructionUsage,
  isOrgAdmin,
} from "@orbs/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import {
  Blocks,
  BookText,
  Eye,
  Globe,
  type LucideIcon,
  Pencil,
  Plug,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { InstructionsReader } from "../components/InstructionsReader.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmDialog } from "../components/ui/confirm-dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import { t as tNow, useT } from "../i18n/index.ts";
import { orpc } from "../lib/rpc.ts";
import { cn } from "../lib/utils.ts";
import { ConnectionsPanel } from "./ConnectionsPanel.tsx";

interface Section {
  id: "instructions" | "skills" | "mcp" | "plugins";
  icon: LucideIcon;
}

export const CUSTOMIZE_SECTIONS: Section[] = [
  { id: "instructions", icon: BookText },
  { id: "skills", icon: Sparkles },
  { id: "mcp", icon: Plug },
  { id: "plugins", icon: Blocks },
];

const EDITABLE_KINDS: Record<string, { kind: CustomizationKind }> = {
  instructions: { kind: "instruction" },
  skills: { kind: "skill" },
  plugins: { kind: "plugin" },
};

const NOUN_KEY = {
  instruction: "customize.noun.instruction",
  skill: "customize.noun.skill",
  plugin: "customize.noun.plugin",
} as const;

const NEW_TITLE_KEY = {
  instruction: "customize.newTitle.instruction",
  skill: "customize.newTitle.skill",
  plugin: "customize.newTitle.plugin",
} as const;

function templateFor(kind: CustomizationKind): string {
  if (kind === "instruction") return tNow("customize.template.instruction");
  if (kind === "skill") return tNow("customize.template.skill");
  return JSON.stringify(
    {
      name: tNow("customize.template.pluginName"),
      version: "1.0.0",
      displayName: tNow("customize.template.pluginDisplay"),
      description: tNow("customize.template.pluginDesc"),
      permissions: { connectors: [], shell: false, network: false },
      skills: [],
    },
    null,
    2,
  );
}

function CustomizationEditor({
  kind,
  initial,
  isAdmin,
  siblings,
  meId,
  defaultProjectId,
  onClose,
}: {
  kind: CustomizationKind;
  initial: Customization | null;
  isAdmin: boolean;
  /** The other items of this kind the person can see, to work out how much room an instruction has left. */
  siblings: Customization[];
  meId: string;
  /** A new item starts out limited to this project (when the person came from one). */
  defaultProjectId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: projects } = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? templateFor(kind));
  const [chosenScope, setScope] = useState<"user" | "org">(initial?.scope ?? "user");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(
    initial?.appliesTo ?? (defaultProjectId ? "projects" : "all"),
  );
  const [projectIds, setProjectIds] = useState<string[]>(
    initial?.projects.map((p) => p.id) ?? (defaultProjectId ? [defaultProjectId] : []),
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  // Sharing with the workspace is for admins, and for whoever created every project it is limited to.
  // Who the person is and which projects exist decide what they may share; until both are known, change nothing.
  const projectsReady = projects !== undefined && meId !== "";
  const canShare =
    isAdmin ||
    (projectsReady &&
      appliesTo === "projects" &&
      projectIds.length > 0 &&
      projectIds.every((id) => projects?.find((p) => p.id === id)?.editable));
  // While the projects are still loading nothing is changed: a shared item must not turn personal by a slow load.
  const scope = chosenScope === "org" && !canShare && projectsReady ? "user" : chosenScope;
  const noProjectChosen = appliesTo === "projects" && projectIds.length === 0;
  const toggleProject = (id: string) =>
    setProjectIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const onSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.customizations.key() });
    onClose();
  };
  const create = useMutation(orpc.customizations.create.mutationOptions({ onSuccess }));
  const update = useMutation(orpc.customizations.update.mutationOptions({ onSuccess }));
  const error = create.error ?? update.error;
  // An instruction has a fixed room in the prompt; say how much of it this one takes, before the server has to refuse.
  const usage =
    kind === "instruction"
      ? instructionUsage(
          siblings.map((s) => ({ ...s, projectIds: s.projects.map((p) => p.id) })),
          {
            id: initial?.id,
            scope,
            appliesTo,
            projectIds: appliesTo === "projects" ? projectIds : [],
            ownerId: initial?.ownerId ?? meId,
            enabled,
            name,
            body,
          },
        )
      : null;
  const overLimit = usage ? usage.used > usage.limit : false;

  function submit(e: FormEvent) {
    e.preventDefault();
    const fields: Omit<CustomizationInput, "kind"> = {
      scope,
      appliesTo,
      projectIds: appliesTo === "projects" ? projectIds : [],
      name,
      description,
      body,
      enabled,
    };
    if (initial) update.mutate({ id: initial.id, patch: fields });
    else create.mutate({ kind, ...fields });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-primary/40 bg-card p-5">
      <h2 className="font-semibold">
        {initial ? t("customize.editTitle", { noun: t(NOUN_KEY[kind]) }) : t(NEW_TITLE_KEY[kind])}
      </h2>
      <Input
        placeholder={t("customize.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
      />
      <Input
        placeholder={t("customize.description")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        spellCheck={false}
        aria-label={kind === "plugin" ? t("customize.bodyPlugin") : t("customize.bodyText")}
        className="w-full rounded-lg border border-border bg-card p-3 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {usage && (
        <p className={cn("text-xs", overLimit ? "text-destructive" : "text-muted-foreground")}>
          {t(overLimit ? "customize.roomOver" : "customize.room", {
            used: usage.used,
            limit: usage.limit,
            tier: t(`customize.tier.${usage.tier}`),
          })}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          {t("customize.appliesIn")}
          <select
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value as AppliesTo)}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="all">{t("customize.appliesAll")}</option>
            <option value="all_projects">{t("customize.appliesAllProjects")}</option>
            <option value="projects">{t("customize.appliesProjectsPick")}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          {t("customize.owner")}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "user" | "org")}
            disabled={!canShare}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="user">{t("customize.ownerPersonal")}</option>
            {canShare && (
              <option value="org">
                {appliesTo === "projects" ? t("customize.ownerProjects") : t("customize.ownerOrg")}
              </option>
            )}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}
          {t("customize.enabled")}
        </label>
      </div>
      {appliesTo === "projects" && (
        <fieldset className="space-y-1.5 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs text-muted-foreground">{t("customize.pickProjects")}</legend>
          {(projects ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">{t("customize.noProjects")}</p>
          )}
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {(projects ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={projectIds.includes(p.id)}
                  onChange={() => toggleProject(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
          {noProjectChosen && <p className="text-xs text-destructive">{t("customize.pickOne")}</p>}
        </fieldset>
      )}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={create.isPending || update.isPending || overLimit || noProjectChosen || !projectsReady}
        >
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function CustomizationManager({ sectionId, summary }: { sectionId: string; summary: string }) {
  const t = useT();
  const cfg = EDITABLE_KINDS[sectionId];
  const queryClient = useQueryClient();
  const { data: me } = useQuery(orpc.me.queryOptions());
  const isAdmin = isOrgAdmin(me?.role);
  const { data: items } = useQuery({
    ...orpc.customizations.list.queryOptions({ input: { kind: cfg?.kind } }),
    enabled: Boolean(cfg),
  });
  const { project: requestedProject } = useSearch({ from: "/app/customize/$section" });
  const { data: projects = [] } = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  // A link may name a project that is gone (or never was): then there is nothing to filter by.
  const filterName = requestedProject ? projects.find((p) => p.id === requestedProject)?.name : undefined;
  const projectFilter = filterName === undefined ? undefined : requestedProject;
  // Coming from a project, show only the instructions that apply there.
  const shown =
    projectFilter && cfg?.kind === "instruction"
      ? items?.filter((i) =>
          appliesHere({ appliesTo: i.appliesTo, projectIds: i.projects.map((p) => p.id) }, projectFilter),
        )
      : items;
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState<Customization | "new" | null>(null);
  const [deleting, setDeleting] = useState<Customization | null>(null);
  const remove = useMutation(
    orpc.customizations.delete.mutationOptions({
      onSuccess: async () => {
        setDeleting(null);
        await queryClient.invalidateQueries({ queryKey: orpc.customizations.key() });
      },
    }),
  );
  const toggle = useMutation(
    orpc.customizations.update.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.customizations.key() }),
    }),
  );
  if (!cfg) return null;
  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{summary}</p>
        <div className="flex shrink-0 items-center gap-2">
          {cfg.kind === "instruction" && (
            <Button variant="secondary" onClick={() => setReading(true)}>
              <Eye className="size-4" /> {t("reader.open")}
            </Button>
          )}
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("customize.new")}
          </Button>
        </div>
      </div>
      {cfg.kind === "instruction" && projectFilter && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          {filterName ? t("customize.filterProject", { name: filterName }) : null}
          <Link
            to="/customize/$section"
            params={{ section: "instructions" }}
            search={{}}
            className="text-primary hover:underline"
          >
            {t("customize.filterClear")}
          </Link>
        </p>
      )}
      {cfg.kind === "instruction" && (
        <InstructionsReader
          key={projectFilter ?? "none"}
          open={reading}
          onClose={() => setReading(false)}
          initialProjectId={projectFilter ?? null}
        />
      )}
      {editing && (
        <CustomizationEditor
          key={editing === "new" ? "new" : editing.id}
          kind={cfg.kind}
          initial={editing === "new" ? null : editing}
          isAdmin={isAdmin}
          siblings={items ?? []}
          meId={me?.user.id ?? ""}
          defaultProjectId={projectFilter}
          onClose={() => setEditing(null)}
        />
      )}
      {shown?.length === 0 && !editing && (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("customize.empty", { noun: t(NOUN_KEY[cfg.kind]) })}
        </p>
      )}
      <ul className="space-y-2">
        {shown?.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.name}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {item.scope === "org" ? <Users className="size-3" /> : null}
                  {item.scope === "org" ? t("customize.scopeOrg") : t("customize.scopePersonal")}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Globe className="size-3" />{" "}
                  {item.appliesTo === "projects"
                    ? t("customize.projectsBadge", { names: item.projects.map((p) => p.name).join(", ") })
                    : item.appliesTo === "all_projects"
                      ? t("customize.appliesAllProjects")
                      : t("customize.appliesAll")}
                </span>
                {!item.enabled && (
                  <span className="text-xs text-muted-foreground">{t("customize.disabled")}</span>
                )}
              </div>
              {item.description && <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                v{item.version}
                {item.ownerName ? t("customize.by", { name: item.ownerName }) : ""}
              </p>
            </div>
            {item.editable && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: item.id, patch: { enabled: !item.enabled } })}
                  className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  {item.enabled ? t("customize.disable") : t("customize.enable")}
                </button>
                <button
                  type="button"
                  aria-label={t("customize.editAria", { name: item.name })}
                  onClick={() => setEditing(item)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={t("customize.deleteAria", { name: item.name })}
                  onClick={() => setDeleting(item)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        title={t("customize.deleteTitle", { noun: t(NOUN_KEY[cfg.kind]) })}
        description={t("customize.deleteBody", { name: deleting?.name ?? "" })}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

export function CustomizePage() {
  const t = useT();
  const { section } = useParams({ from: "/app/customize/$section" });
  const current = CUSTOMIZE_SECTIONS.find((s) => s.id === section) ?? CUSTOMIZE_SECTIONS[1];
  if (!current) return null;
  const Icon = current.icon;
  return (
    <div className="flex h-full min-h-0">
      <nav className="w-56 shrink-0 space-y-0.5 border-r border-border p-3">
        <p className="px-2 pb-2 text-sm font-semibold">{t("customize.title")}</p>
        {CUSTOMIZE_SECTIONS.map(({ id, icon: ItemIcon }) => (
          <Link
            key={id}
            to="/customize/$section"
            params={{ section: id }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted",
              current.id === id && "bg-muted font-medium",
            )}
          >
            <ItemIcon className="size-4" /> {t(`customize.${id}.label`)}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
              <Icon className="size-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold">{t(`customize.${current.id}.title`)}</h1>
            </div>
          </div>
          {current.id === "mcp" ? (
            <ConnectionsPanel />
          ) : (
            <>
              <CustomizationManager sectionId={current.id} summary={t(`customize.${current.id}.summary`)} />
              {current.id !== "instructions" && (
                <p className="mt-6 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {t("customize.agentNote")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
