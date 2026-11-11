/**
 * Which saved instructions apply to a person in a conversation. One place, used both to write the prompt and to show
 * the person what the assistant reads, so what they see is what is sent.
 */
import { schema } from "@orbs/db";
import { type AppliesTo, appliesHere, type InstructionTier, instructionTier } from "@orbs/protocol";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db } from "../db.ts";

export interface ActiveInstruction {
  id: string;
  name: string;
  body: string;
  tier: InstructionTier;
  scope: "user" | "org";
  appliesTo: AppliesTo;
  /** Who wrote it. */
  ownerName: string | null;
  /** The projects it is limited to, by name. */
  projectNames: string[];
}

/**
 * The enabled instructions that apply to this person in a conversation of this project (null = outside any project):
 * the workspace's, and the person's own. Other people's personal ones never appear.
 */
export async function activeInstructions(
  orgId: string,
  userId: string,
  projectId: string | null,
): Promise<ActiveInstruction[]> {
  const C = schema.customization;
  const saved = await db
    .select({
      id: C.id,
      scope: C.scope,
      ownerId: C.ownerId,
      ownerName: schema.user.name,
      appliesTo: C.appliesTo,
      name: C.name,
      body: C.body,
    })
    .from(C)
    .leftJoin(schema.user, eq(schema.user.id, C.ownerId))
    .where(
      and(
        eq(C.orgId, orgId),
        eq(C.kind, "instruction"),
        eq(C.enabled, true),
        // Other people's personal instructions are never read, so they are not even loaded.
        or(eq(C.scope, "org"), eq(C.ownerId, userId)),
      ),
    )
    .orderBy(asc(C.createdAt));

  const limitedTo = saved.filter((i) => i.appliesTo === "projects").map((i) => i.id);
  const links =
    limitedTo.length === 0
      ? []
      : await db
          .select({
            customizationId: schema.customizationProject.customizationId,
            projectId: schema.customizationProject.projectId,
            name: schema.project.name,
          })
          .from(schema.customizationProject)
          .innerJoin(schema.project, eq(schema.project.id, schema.customizationProject.projectId))
          .where(inArray(schema.customizationProject.customizationId, limitedTo))
          .orderBy(asc(schema.project.name));
  const linksOf = (id: string) => links.filter((l) => l.customizationId === id);

  return saved
    .filter(
      (i) =>
        appliesHere(
          { appliesTo: i.appliesTo, projectIds: linksOf(i.id).map((l) => l.projectId) },
          projectId,
        ) &&
        (i.scope === "org" || i.ownerId === userId),
    )
    .filter((i) => i.body.trim()) // an empty one adds nothing to the prompt, so it isn't "active"
    .map((i) => ({
      id: i.id,
      name: i.name,
      body: i.body,
      // The level comes from what the instruction is, not from where it applies: a person's own note kept for one
      // project is still theirs, and only the workspace's own instructions can speak for a project.
      tier: instructionTier(i.scope, i.appliesTo),
      scope: i.scope,
      appliesTo: i.appliesTo,
      ownerName: i.ownerName,
      projectNames: linksOf(i.id).map((l) => l.name),
    }));
}
