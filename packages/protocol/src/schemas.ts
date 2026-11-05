import { z } from "zod";

export const Mode = z.enum(["work", "code"]);
export type Mode = z.infer<typeof Mode>;

export const DataClass = z.enum(["public", "internal", "confidential"]);
export type DataClass = z.infer<typeof DataClass>;

export const Harness = z.enum(["claude-code", "codex", "opencode", "pi"]);
export type Harness = z.infer<typeof Harness>;

/**
 * "Mesin" (engine) selection for a thread:
 * - auto:  the router picks a model per request within the org's data policy
 * - model: Orbs' built-in agent runs on one specific model
 * - agent: an external coding agent runs through a harness adapter
 */
export const Engine = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("auto") }),
  z.object({ kind: z.literal("model"), provider: z.string().min(1), modelId: z.string().min(1) }),
  z.object({ kind: z.literal("agent"), harness: Harness }),
]);
export type Engine = z.infer<typeof Engine>;

export const EngineOption = z.object({
  engine: Engine,
  label: z.string(),
  description: z.string(),
  available: z.boolean(),
  /** Why the option is unavailable (not configured yet, blocked by policy, ...). */
  reason: z.string().optional(),
});
export type EngineOption = z.infer<typeof EngineOption>;

export const Thread = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  mode: Mode,
  engine: Engine,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Thread = z.infer<typeof Thread>;

/** Canonical event envelope shared by every stream (threads, org, ...). */
export const OrbsEvent = z.object({
  seq: z.number().int(),
  id: z.string(),
  streamType: z.string(),
  streamId: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  actorId: z.string().nullable(),
  occurredAt: z.string(),
});
export type OrbsEvent = z.infer<typeof OrbsEvent>;

export const Me = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  activeOrgId: z.string().nullable(),
  /** Role inside the active organization (owner, admin, member). */
  role: z.string().nullable(),
  /** True for Orbs system administrators (manage the whole install). */
  isSystemAdmin: z.boolean(),
});
export type Me = z.infer<typeof Me>;

export const SystemRole = z.enum(["admin", "user"]);
export type SystemRole = z.infer<typeof SystemRole>;

export const AdminUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: SystemRole,
  banned: z.boolean(),
  banReason: z.string().nullable(),
  createdAt: z.string(),
  orgCount: z.number().int(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminOrg = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  memberCount: z.number().int(),
  threadCount: z.number().int(),
});
export type AdminOrg = z.infer<typeof AdminOrg>;

export const AuditEntry = z.object({
  id: z.number().int(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  orgName: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  mode: Mode,
  fileCount: z.number().int(),
  totalBytes: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const ProjectFileEntry = z.object({ path: z.string(), size: z.number().int() });
export type ProjectFileEntry = z.infer<typeof ProjectFileEntry>;

export const FileContent = z.object({
  path: z.string(),
  size: z.number().int(),
  /** Null when the file is binary. */
  content: z.string().nullable(),
  binary: z.boolean(),
  /** True when only the first part of a large text file is returned. */
  truncated: z.boolean(),
});
export type FileContent = z.infer<typeof FileContent>;
