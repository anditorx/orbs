/**
 * Saved instructions: who wrote them decides their authority, and each level has its own room in the prompt, so one
 * level can't push another out. Pure functions, shared by the server (which refuses a save that doesn't fit) and the
 * editor (which shows how much room is left), so the two can't disagree.
 */

import { isOrgAdmin } from "./roles.ts";
import type { AppliesTo } from "./schemas.ts";

/** Who an instruction speaks for, from most to least authority. */
export type InstructionTier = "org" | "project" | "user";

/** Characters each level may use in one conversation. Together they are the most the prompt carries. */
export const INSTRUCTION_LIMIT: Record<InstructionTier, number> = {
  org: 3_000,
  project: 2_500,
  user: 2_500,
};
export const MAX_INSTRUCTION_CHARS =
  INSTRUCTION_LIMIT.org + INSTRUCTION_LIMIT.project + INSTRUCTION_LIMIT.user;

/**
 * The level of an instruction, from what it really is: the workspace's own (for everywhere), a project's (limited to
 * chosen projects) or the person's own. A personal instruction stays personal even when it is kept for one project.
 */
export function instructionTier(scope: "user" | "org", appliesTo: AppliesTo): InstructionTier {
  if (scope === "user") return "user";
  return appliesTo === "projects" ? "project" : "org";
}

/** Whether something that applies like this takes effect in a conversation of this project (null = outside any project). */
export function appliesHere(
  item: { appliesTo: AppliesTo; projectIds: readonly string[] },
  projectId: string | null,
): boolean {
  if (item.appliesTo === "all") return true;
  if (projectId === null) return false;
  return item.appliesTo === "all_projects" || item.projectIds.includes(projectId);
}

/** What an instruction costs in the prompt: its name and its text. */
export const instructionChars = (name: string, body: string) =>
  name.replace(/\s+/g, " ").trim().length + body.trim().length;

/**
 * The most a conversation can carry from these instructions, over every place a conversation can be: outside any
 * project, inside a project none of them names, and inside each project they name. Counting the worst case keeps the
 * promise "this fits" true wherever the conversation happens.
 */
export function worstCaseChars(
  items: { appliesTo: AppliesTo; projectIds: readonly string[]; chars: number }[],
): number {
  const places: (string | null)[] = [null, "\u0000any-other-project"];
  for (const item of items) if (item.appliesTo === "projects") places.push(...item.projectIds);
  let worst = 0;
  for (const place of new Set(places)) {
    const here = items.reduce((sum, i) => sum + (appliesHere(i, place) ? i.chars : 0), 0);
    if (here > worst) worst = here;
  }
  return worst;
}

export interface InstructionLike {
  id?: string;
  scope: "user" | "org";
  appliesTo: AppliesTo;
  projectIds: readonly string[];
  /** Whose personal instruction it is; ignored for the workspace's. */
  ownerId: string | null;
  enabled: boolean;
  name: string;
  body: string;
}

/**
 * How much of its level's room an instruction uses once `draft` is saved: the enabled instructions of the same level
 * (the same person's, for personal ones) other than the draft itself, plus the draft when it is enabled.
 */
export function instructionUsage(
  others: InstructionLike[],
  draft: InstructionLike,
): { tier: InstructionTier; used: number; limit: number } {
  const tier = instructionTier(draft.scope, draft.appliesTo);
  const sameLevel = others.filter(
    (o) =>
      o.enabled &&
      (draft.id === undefined || o.id !== draft.id) &&
      instructionTier(o.scope, o.appliesTo) === tier &&
      (tier !== "user" || o.ownerId === draft.ownerId),
  );
  const all = [...sameLevel, ...(draft.enabled ? [draft] : [])];
  const used = worstCaseChars(
    all.map((i) => ({
      appliesTo: i.appliesTo,
      projectIds: i.projectIds,
      chars: instructionChars(i.name, i.body),
    })),
  );
  return { tier, used, limit: INSTRUCTION_LIMIT[tier] };
}

/**
 * Sharing with the workspace is for admins, and for the creator of every project it is limited to: a project's own
 * team writes its rules without asking an admin, but nobody else's.
 */
export function mayShareWithWorkspace(
  viewer: { userId: string; role: string | null },
  appliesTo: AppliesTo,
  projects: { createdBy: string | null }[],
): boolean {
  if (isOrgAdmin(viewer.role)) return true;
  return (
    appliesTo === "projects" && projects.length > 0 && projects.every((p) => p.createdBy === viewer.userId)
  );
}
