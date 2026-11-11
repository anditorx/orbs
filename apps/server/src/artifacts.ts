/**
 * Pages the assistant makes for a conversation (dashboards, reports), saved as numbered versions. A page belongs to the
 * person who owns the conversation and is readable by nobody else. Its HTML is never interpreted here: it is stored as
 * text and shown only inside a sandboxed frame by the browser.
 */
import { schema } from "@orbs/db";
import { type ArtifactDetail, type ArtifactSummary, artifactProblem } from "@orbs/protocol";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { db } from "./db.ts";
import { appendEvent } from "./events.ts";

/** Pages in one conversation and versions of one page: a cap on what a runaway loop could store. */
export const MAX_ARTIFACTS_PER_THREAD = 20;
export const MAX_VERSIONS_PER_ARTIFACT = 50;

/** A refusal the assistant (or the person) can read and act on. */
export class ArtifactError extends Error {}

async function ownedThread(orgId: string, threadId: string, userId: string) {
  const [row] = await db
    .select({ id: schema.thread.id })
    .from(schema.thread)
    .where(
      and(
        eq(schema.thread.id, threadId),
        eq(schema.thread.orgId, orgId),
        eq(schema.thread.createdBy, userId),
      ),
    )
    .limit(1);
  if (!row) throw new ArtifactError("That conversation was not found.");
}

async function ownedArtifact(orgId: string, userId: string, artifactId: string) {
  const [row] = await db
    .select()
    .from(schema.artifact)
    .where(
      and(
        eq(schema.artifact.id, artifactId),
        eq(schema.artifact.orgId, orgId),
        eq(schema.artifact.ownerId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface SaveInput {
  orgId: string;
  threadId: string;
  userId: string;
  /** The reply that wrote it. */
  turnId?: string;
  /** Set to add a version to a page that exists; leave out to make a new page. */
  artifactId?: string;
  title?: string;
  html: string;
}

/** Saves a new page or a new version of one, and tells the conversation so every open tab shows it. */
export async function saveArtifact(
  input: SaveInput,
): Promise<{ artifactId: string; version: number; title: string }> {
  await ownedThread(input.orgId, input.threadId, input.userId);
  const existing = input.artifactId ? await ownedArtifact(input.orgId, input.userId, input.artifactId) : null;
  if (input.artifactId && (!existing || existing.threadId !== input.threadId)) {
    throw new ArtifactError("There is no dashboard with that artifact_id in this conversation.");
  }
  const title = (input.title ?? existing?.title ?? "").trim();
  const problem = artifactProblem(title, input.html);
  if (problem) throw new ArtifactError(problem);

  return db.transaction(async (tx) => {
    let artifactId = existing?.id;
    if (!artifactId) {
      const made = await tx
        .select({ id: schema.artifact.id })
        .from(schema.artifact)
        .where(eq(schema.artifact.threadId, input.threadId));
      if (made.length >= MAX_ARTIFACTS_PER_THREAD) {
        throw new ArtifactError(
          `This conversation already has ${MAX_ARTIFACTS_PER_THREAD} dashboards. Update one of them instead.`,
        );
      }
      const [row] = await tx
        .insert(schema.artifact)
        .values({ orgId: input.orgId, threadId: input.threadId, ownerId: input.userId, title })
        .returning({ id: schema.artifact.id });
      if (!row) throw new Error("artifact insert returned no row");
      artifactId = row.id;
    }
    const [latest] = await tx
      .select({ n: max(schema.artifactVersion.version) })
      .from(schema.artifactVersion)
      .where(eq(schema.artifactVersion.artifactId, artifactId));
    const version = (latest?.n ?? 0) + 1;
    if (version > MAX_VERSIONS_PER_ARTIFACT) {
      throw new ArtifactError(`This dashboard already has ${MAX_VERSIONS_PER_ARTIFACT} versions.`);
    }
    await tx.insert(schema.artifactVersion).values({
      artifactId,
      version,
      html: input.html,
      ...(input.turnId ? { turnId: input.turnId } : {}),
    });
    await tx
      .update(schema.artifact)
      .set({ title, updatedAt: new Date() })
      .where(eq(schema.artifact.id, artifactId));
    await appendEvent(
      {
        orgId: input.orgId,
        streamType: "thread",
        streamId: input.threadId,
        type: "artifact.saved",
        payload: {
          artifactId,
          version,
          title,
          created: !existing,
          ...(input.turnId ? { turnId: input.turnId } : {}),
        },
        actorId: null,
      },
      tx,
    );
    return { artifactId, version, title };
  });
}

/** The pages of one conversation, newest first, each with its versions. Only the conversation's owner may ask. */
export async function listArtifacts(
  orgId: string,
  userId: string,
  threadId: string,
): Promise<ArtifactSummary[]> {
  await ownedThread(orgId, threadId, userId);
  const rows = await db
    .select()
    .from(schema.artifact)
    .where(and(eq(schema.artifact.threadId, threadId), eq(schema.artifact.ownerId, userId)))
    .orderBy(desc(schema.artifact.updatedAt));
  const out: ArtifactSummary[] = [];
  for (const a of rows) {
    const versions = await db
      .select({ version: schema.artifactVersion.version, createdAt: schema.artifactVersion.createdAt })
      .from(schema.artifactVersion)
      .where(eq(schema.artifactVersion.artifactId, a.id))
      .orderBy(asc(schema.artifactVersion.version));
    const last = versions.at(-1);
    out.push({
      id: a.id,
      threadId: a.threadId,
      title: a.title,
      version: last?.version ?? 0,
      versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString() })),
      updatedAt: a.updatedAt.toISOString(),
    });
  }
  return out;
}

/**
 * One version of a page (the newest by default), or null when it isn't the caller's or doesn't exist. With `threadId`,
 * only a page of that conversation is returned (the assistant may read only the pages of the conversation it is in).
 */
export async function getArtifact(
  orgId: string,
  userId: string,
  artifactId: string,
  version?: number,
  threadId?: string,
): Promise<ArtifactDetail | null> {
  const artifact = await ownedArtifact(orgId, userId, artifactId);
  if (!artifact || (threadId && artifact.threadId !== threadId)) return null;
  const [row] = await db
    .select()
    .from(schema.artifactVersion)
    .where(
      and(
        eq(schema.artifactVersion.artifactId, artifactId),
        ...(version ? [eq(schema.artifactVersion.version, version)] : []),
      ),
    )
    .orderBy(desc(schema.artifactVersion.version))
    .limit(1);
  return row ? { id: artifact.id, title: artifact.title, version: row.version, html: row.html } : null;
}
