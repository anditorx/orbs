import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  AdminOrg,
  AdminUser,
  AuditEntry,
  Engine,
  EngineOption,
  FileContent,
  Me,
  Mode,
  OrbsEvent,
  Project,
  ProjectFileEntry,
  SystemRole,
  Thread,
} from "./schemas.ts";

/**
 * The API contract between Orbs clients (web, desktop) and the server.
 * Writes go through explicit procedures that append events; reads subscribe to event streams.
 */
export const contract = {
  health: oc.output(z.object({ ok: z.boolean(), version: z.string() })),
  me: oc.output(Me),
  engines: {
    list: oc.output(z.object({ options: z.array(EngineOption) })),
  },
  threads: {
    list: oc.input(z.object({ limit: z.number().int().min(1).max(200).default(50) })).output(z.array(Thread)),
    create: oc
      .input(
        z.object({
          title: z.string().trim().min(1).max(200),
          mode: Mode.default("work"),
          engine: Engine.default({ kind: "auto" }),
          projectId: z.string().optional(),
        }),
      )
      .output(Thread),
    postMessage: oc
      .input(z.object({ threadId: z.string(), text: z.string().trim().min(1).max(20_000) }))
      .output(z.object({ eventId: z.string(), seq: z.number().int() })),
    rename: oc
      .input(z.object({ threadId: z.string(), title: z.string().trim().min(1).max(200) }))
      .output(Thread),
    /** Permanently deletes a conversation and its messages (creator or org owner/admin). */
    delete: oc.input(z.object({ threadId: z.string() })).output(z.object({ deleted: z.literal(true) })),
  },
  /** Projects: Code-mode workspaces whose files are uploaded from the user's machine. */
  projects: {
    list: oc.input(z.object({ mode: Mode.optional() })).output(z.array(Project)),
    create: oc
      .input(z.object({ name: z.string().trim().min(1).max(200), mode: Mode.default("code") }))
      .output(Project),
    /** Uploads one batch of files (the client splits big folders into several batches). */
    uploadFiles: oc
      .input(
        z.object({
          projectId: z.string(),
          files: z
            .array(z.object({ path: z.string(), file: z.instanceof(Blob) }))
            .min(1)
            .max(200),
        }),
      )
      .output(
        z.object({
          saved: z.number().int(),
          skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
        }),
      ),
    files: oc.input(z.object({ projectId: z.string() })).output(z.array(ProjectFileEntry)),
    readFile: oc.input(z.object({ projectId: z.string(), path: z.string() })).output(FileContent),
    delete: oc.input(z.object({ projectId: z.string() })).output(z.object({ deleted: z.literal(true) })),
  },
  /** System administration — requires a system administrator (user.role = "admin"). */
  admin: {
    overview: oc.output(
      z.object({
        users: z.number().int(),
        admins: z.number().int(),
        bannedUsers: z.number().int(),
        organizations: z.number().int(),
        threads: z.number().int(),
        signupMode: z.enum(["open", "invite-only", "domain"]),
        signupDomains: z.array(z.string()),
      }),
    ),
    users: {
      list: oc.input(z.object({ search: z.string().trim().max(200).optional() })).output(z.array(AdminUser)),
      create: oc
        .input(
          z.object({
            name: z.string().trim().min(1).max(200),
            email: z.string().trim().email(),
            password: z.string().min(8).max(200),
            role: SystemRole.default("user"),
          }),
        )
        .output(z.object({ id: z.string() })),
      setRole: oc
        .input(z.object({ userId: z.string(), role: SystemRole }))
        .output(z.object({ ok: z.literal(true) })),
      ban: oc
        .input(z.object({ userId: z.string(), reason: z.string().trim().max(500).optional() }))
        .output(z.object({ ok: z.literal(true) })),
      unban: oc.input(z.object({ userId: z.string() })).output(z.object({ ok: z.literal(true) })),
    },
    orgs: {
      list: oc.output(z.array(AdminOrg)),
    },
    audit: {
      list: oc
        .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
        .output(z.array(AuditEntry)),
    },
  },
  events: {
    list: oc
      .input(
        z.object({
          streamType: z.string(),
          streamId: z.string(),
          afterSeq: z.number().int().default(0),
        }),
      )
      .output(z.array(OrbsEvent)),
    /** Live events for the active organization, optionally filtered to one stream. */
    subscribe: oc
      .input(
        z.object({
          streamType: z.string().optional(),
          streamId: z.string().optional(),
        }),
      )
      .output(eventIterator(OrbsEvent)),
  },
};

export type Contract = typeof contract;
