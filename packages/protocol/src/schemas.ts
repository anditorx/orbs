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
  /** Role inside the active organization (org.admin or org.member). */
  role: z.string().nullable(),
  /** True for Orbs system administrators (manage the whole install). */
  isSystemAdmin: z.boolean(),
  /** Name of the active organization (set even when a system admin entered it without being a member). */
  activeOrgName: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

export const SystemRole = z.enum(["system.admin", "user"]);
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
  /** Usage in the current billing month (WIB). */
  monthTokens: z.number().int(),
  monthCostIdr: z.number().int(),
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

// ---- Usage, budgets and customization ----

export const BudgetUnit = z.enum(["tokens", "idr"]);
export type BudgetUnit = z.infer<typeof BudgetUnit>;

export const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format periode: YYYY-MM");

export const UsageTotals = z.object({
  requests: z.number().int(),
  inputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  outputTokens: z.number().int(),
  reasoningTokens: z.number().int(),
  totalTokens: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

export const UsageByProject = z.object({
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  requests: z.number().int(),
  totalTokens: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageByProject = z.infer<typeof UsageByProject>;

export const UsageByModel = z.object({
  provider: z.string(),
  modelId: z.string(),
  requests: z.number().int(),
  totalTokens: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageByModel = z.infer<typeof UsageByModel>;

export const UsageByDay = z.object({
  day: z.string(),
  totalTokens: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageByDay = z.infer<typeof UsageByDay>;

export const BudgetStatus = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  unit: BudgetUnit,
  limit: z.number().int(),
  /** Usage counted toward the limit (after any reset). */
  used: z.number().int(),
  remaining: z.number().int(),
  percent: z.number().int(),
  exceeded: z.boolean(),
});
export type BudgetStatus = z.infer<typeof BudgetStatus>;

export const UsageSummary = z.object({
  period: Period,
  totals: UsageTotals,
  byProject: z.array(UsageByProject),
  byModel: z.array(UsageByModel),
  byDay: z.array(UsageByDay),
  budgets: z.array(BudgetStatus),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

export const TeamUsageRow = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  requests: z.number().int(),
  totalTokens: z.number().int(),
  costIdr: z.number().int(),
  /** Share of the team's total cost in this view, 0–100. */
  sharePercent: z.number().int(),
  budgets: z.array(BudgetStatus),
});
export type TeamUsageRow = z.infer<typeof TeamUsageRow>;

export const TeamUsage = z.object({
  period: Period,
  projectId: z.string().nullable(),
  fxUsdIdr: z.number(),
  totals: UsageTotals,
  /** Sorted by cost, highest first. */
  rows: z.array(TeamUsageRow),
});
export type TeamUsage = z.infer<typeof TeamUsage>;

export const UsageByThread = z.object({
  threadId: z.string().nullable(),
  /** Null when the conversation has since been deleted. */
  title: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  requests: z.number().int(),
  totalTokens: z.number().int(),
  costIdr: z.number().int(),
  lastAt: z.string(),
});
export type UsageByThread = z.infer<typeof UsageByThread>;

/** Metadata only: which project/conversation/model, never the prompt text itself. */
export const UserUsageDetail = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  period: Period,
  totals: UsageTotals,
  byProject: z.array(UsageByProject),
  byThread: z.array(UsageByThread),
  byModel: z.array(UsageByModel),
  budgets: z.array(BudgetStatus),
});
export type UserUsageDetail = z.infer<typeof UserUsageDetail>;

export const BudgetInput = z.object({
  /** Null = default for every member. */
  userId: z.string().nullable().default(null),
  /** Null = across all projects. */
  projectId: z.string().nullable().default(null),
  unit: BudgetUnit,
  limit: z.number().int().min(1).max(1_000_000_000_000),
});
export type BudgetInput = z.infer<typeof BudgetInput>;

export const CustomizationKind = z.enum(["instruction", "skill", "plugin"]);
export type CustomizationKind = z.infer<typeof CustomizationKind>;

export const CustomizationScope = z.enum(["user", "org"]);
export type CustomizationScope = z.infer<typeof CustomizationScope>;

export const Customization = z.object({
  id: z.string(),
  kind: CustomizationKind,
  scope: CustomizationScope,
  /** Null = applies in every project. */
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  /** True when the current user may edit or delete it. */
  editable: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Customization = z.infer<typeof Customization>;

export const CustomizationInput = z.object({
  kind: CustomizationKind,
  scope: CustomizationScope.default("user"),
  projectId: z.string().nullable().default(null),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  body: z.string().max(100_000).default(""),
  enabled: z.boolean().default(true),
});
export type CustomizationInput = z.infer<typeof CustomizationInput>;

// ---- System administration of companies and accounts ----

export const AdminOrgMember = z.object({
  memberId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
});
export type AdminOrgMember = z.infer<typeof AdminOrgMember>;

export const AdminOrgInvitation = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  expiresAt: z.string(),
});
export type AdminOrgInvitation = z.infer<typeof AdminOrgInvitation>;

export const AdminOrgDetail = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  members: z.array(AdminOrgMember),
  invitations: z.array(AdminOrgInvitation),
});
export type AdminOrgDetail = z.infer<typeof AdminOrgDetail>;
