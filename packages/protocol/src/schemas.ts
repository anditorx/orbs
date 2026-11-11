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
  /** Pinned by the current user: shown first in the sidebar. */
  pinned: z.boolean(),
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
  /** Every organization this account belongs to, with its role there. */
  orgs: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
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
  /** Pinned by the current user: shown first in the sidebar. */
  pinned: z.boolean(),
  /** True when the current user may rename or delete it (creator or organization admin). */
  editable: z.boolean(),
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

export const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM");

export const UsageTotals = z.object({
  requests: z.number().int(),
  inputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  outputTokens: z.number().int(),
  reasoningTokens: z.number().int(),
  totalTokens: z.number().int(),
  /** Cost in millionths of a US dollar (integer, no float drift); 1_000_000 = $1. */
  costMicroUsd: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

export const UsageByProject = z.object({
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  requests: z.number().int(),
  totalTokens: z.number().int(),
  /** Cost in millionths of a US dollar (integer, no float drift); 1_000_000 = $1. */
  costMicroUsd: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageByProject = z.infer<typeof UsageByProject>;

export const UsageByModel = z.object({
  provider: z.string(),
  modelId: z.string(),
  requests: z.number().int(),
  totalTokens: z.number().int(),
  /** Cost in millionths of a US dollar (integer, no float drift); 1_000_000 = $1. */
  costMicroUsd: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageByModel = z.infer<typeof UsageByModel>;

export const UsageByProvider = z.object({
  provider: z.string(),
  requests: z.number().int(),
  totalTokens: z.number().int(),
  costMicroUsd: z.number().int(),
  costIdr: z.number().int(),
});
export type UsageByProvider = z.infer<typeof UsageByProvider>;

export const UsageByDay = z.object({
  day: z.string(),
  totalTokens: z.number().int(),
  /** Cost in millionths of a US dollar (integer, no float drift); 1_000_000 = $1. */
  costMicroUsd: z.number().int(),
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
  byProvider: z.array(UsageByProvider),
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
  /** Cost in millionths of a US dollar (integer, no float drift); 1_000_000 = $1. */
  costMicroUsd: z.number().int(),
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
  /** Cost in millionths of a US dollar (integer, no float drift); 1_000_000 = $1. */
  costMicroUsd: z.number().int(),
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
  byProvider: z.array(UsageByProvider),
  byModel: z.array(UsageByModel),
  byDay: z.array(UsageByDay),
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

/**
 * Where a customization takes effect: every conversation, every conversation that is inside a project, or only
 * the projects it lists.
 */
export const AppliesTo = z.enum(["all", "all_projects", "projects"]);
export type AppliesTo = z.infer<typeof AppliesTo>;

export const Customization = z.object({
  id: z.string(),
  kind: CustomizationKind,
  scope: CustomizationScope,
  appliesTo: AppliesTo,
  /** The projects it is limited to; empty unless `appliesTo` is "projects". */
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
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

/** What the assistant reads from the saved instructions in one place (a conversation, or a project, or neither). */
export const ActiveInstructions = z.object({
  /** The project they were worked out for; null outside any project. */
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tier: z.enum(["org", "project", "user"]),
      scope: CustomizationScope,
      appliesTo: AppliesTo,
      /** Who wrote it. */
      ownerName: z.string().nullable(),
      projectNames: z.array(z.string()),
      chars: z.number().int(),
      /** Whole, cut at its level's limit, or left out for lack of room. */
      fit: z.enum(["whole", "cut", "left_out"]),
    }),
  ),
  /** Characters used and allowed, per level. */
  usage: z.array(
    z.object({ tier: z.enum(["org", "project", "user"]), used: z.number().int(), limit: z.number().int() }),
  ),
  /** The instruction part of the prompt exactly as the assistant gets it; empty when nothing applies. */
  text: z.string(),
});
export type ActiveInstructions = z.infer<typeof ActiveInstructions>;

export const CustomizationInput = z.object({
  kind: CustomizationKind,
  scope: CustomizationScope.default("user"),
  appliesTo: AppliesTo.default("all"),
  /** Needed (at least one) when `appliesTo` is "projects"; ignored otherwise. */
  projectIds: z.array(z.string()).max(100).default([]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  body: z.string().max(100_000).default(""),
  enabled: z.boolean().default(true),
});
export type CustomizationInput = z.infer<typeof CustomizationInput>;

/**
 * Partial update of a customization. Deliberately NOT `CustomizationInput.partial()`: Zod still
 * applies `.default()` values to fields that were left out, which would silently reset them
 * (toggling "enabled" would wipe the body, description, scope and project).
 */
export const CustomizationPatch = z
  .object({
    kind: CustomizationKind,
    scope: CustomizationScope,
    appliesTo: AppliesTo,
    projectIds: z.array(z.string()).max(100),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500),
    body: z.string().max(100_000),
    enabled: z.boolean(),
  })
  .partial();
export type CustomizationPatch = z.infer<typeof CustomizationPatch>;

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

// ---- Model management (system administrators) ----

export const AdminModel = z.object({
  id: z.string(),
  provider: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  inputUsdPerMtok: z.number().nullable(),
  outputUsdPerMtok: z.number().nullable(),
  qualityScore: z.number().nullable(),
  maxDataClass: DataClass,
  /** "Enabled": a disabled model can't be chosen anywhere (it is shown greyed out). */
  active: z.boolean(),
  /** "Active": the model appears in the model lists. Off = hidden everywhere. */
  listed: z.boolean(),
  /** Its provider is connected right now. When not, the model is shown dimmed and can't be chosen. */
  providerConnected: z.boolean(),
  /** The organizations whose model list includes this model, by name. */
  orgs: z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean() })),
});
export type AdminModel = z.infer<typeof AdminModel>;

export const AdminModelInput = z.object({
  provider: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  inputUsdPerMtok: z.number().min(0).max(1_000_000).nullable().default(null),
  outputUsdPerMtok: z.number().min(0).max(1_000_000).nullable().default(null),
  qualityScore: z.number().min(0).max(1).nullable().default(null),
  maxDataClass: DataClass.default("internal"),
  active: z.boolean().default(true),
  listed: z.boolean().default(true),
});
export type AdminModelInput = z.infer<typeof AdminModelInput>;

/** Partial update of a model; no defaults, so leaving a field out never changes it (see CustomizationPatch). */
export const AdminModelPatch = z
  .object({
    provider: z.string().trim().min(1).max(100),
    modelId: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200),
    inputUsdPerMtok: z.number().min(0).max(1_000_000).nullable(),
    outputUsdPerMtok: z.number().min(0).max(1_000_000).nullable(),
    qualityScore: z.number().min(0).max(1).nullable(),
    maxDataClass: DataClass,
    active: z.boolean(),
    listed: z.boolean(),
  })
  .partial();
export type AdminModelPatch = z.infer<typeof AdminModelPatch>;

/** One registry model as seen from a single organization. */
export const OrgModelRow = z.object({
  modelId: z.string(),
  provider: z.string(),
  model: z.string(),
  displayName: z.string(),
  maxDataClass: DataClass,
  /** The model's global switch. */
  active: z.boolean(),
  /** Its provider is connected right now. */
  providerConnected: z.boolean(),
  /** Whether the model appears for this organization. */
  assigned: z.boolean(),
  /** Whether it can be used there (only meaningful when assigned). */
  enabled: z.boolean(),
});
export type OrgModelRow = z.infer<typeof OrgModelRow>;

// ---- External connections (MCP connectors) ----

export const ConnectorToolKind = z.enum(["read", "write", "destructive", "interactive", "unknown"]);
export type ConnectorToolKind = z.infer<typeof ConnectorToolKind>;

export const ConnectorProviderStatus = z.object({
  provider: z.string(),
  name: z.string(),
  /** The server has an encryption key, so credentials can be stored. */
  vaultReady: z.boolean(),
  /** An OAuth app is available: the installation's or the person's own. */
  configured: z.boolean(),
  /** The person's own OAuth app, if they registered one (the secret is never returned). */
  ownApp: z
    .object({
      clientId: z.string(),
      appName: z.string().nullable(),
      description: z.string().nullable(),
      /** The last characters of the stored secret; the secret itself is never returned. */
      secretHint: z.string().nullable(),
    })
    .nullable(),
  /** Exact URL to register as the redirect URI when creating an app in the provider's console. */
  redirectUri: z.string(),
  connection: z
    .object({
      status: z.enum(["active", "needs_reauth"]),
      /** How it was connected: the service's sign-in flow, or a token the person pasted. */
      authMethod: z.enum(["oauth", "token"]),
      accountName: z.string().nullable(),
      accountEmail: z.string().nullable(),
      workspaceName: z.string().nullable(),
      connectedAt: z.string(),
      lastUsedAt: z.string().nullable(),
    })
    .nullable(),
});
export type ConnectorProviderStatus = z.infer<typeof ConnectorProviderStatus>;

export const ConnectorTool = z.object({
  name: z.string(),
  description: z.string(),
  kind: ConnectorToolKind,
  /** Whether Orbs' own policy lets this tool run (only read-only tools do). */
  allowed: z.boolean(),
  /** JSON Schema of the tool's arguments, when the service publishes one. */
  inputSchema: z.record(z.string(), z.unknown()).nullable(),
});
export type ConnectorTool = z.infer<typeof ConnectorTool>;

export const ConnectorAccount = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  workspaces: z.array(z.string()),
});
export type ConnectorAccount = z.infer<typeof ConnectorAccount>;

export const AdminConnector = z.object({
  provider: z.string(),
  name: z.string(),
  vaultReady: z.boolean(),
  configured: z.boolean(),
  /** Public identifier of the OAuth app (the secret is never returned). */
  clientId: z.string().nullable(),
  /** Exact URL to register as the redirect URI in the provider's console. */
  redirectUri: z.string(),
  /** How many people are currently connected. */
  connectionCount: z.number().int(),
});
export type AdminConnector = z.infer<typeof AdminConnector>;

// ---- Custom MCP servers (added by a person, for their own account) ----

export const CustomMcpServer = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  host: z.string(),
  hasToken: z.boolean(),
  allowedTools: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type CustomMcpServer = z.infer<typeof CustomMcpServer>;

export const CustomMcpTool = z.object({
  name: z.string(),
  description: z.string(),
  allowed: z.boolean(),
  /** What the server claims about itself; informational only, never grants access. */
  readOnlyHint: z.boolean().nullable(),
  destructiveHint: z.boolean().nullable(),
  inputSchema: z.record(z.string(), z.unknown()).nullable(),
});
export type CustomMcpTool = z.infer<typeof CustomMcpTool>;

// ---- AI model providers (credentials managed by system administrators) ----

export const ModelProviderStatus = z.object({
  provider: z.string(),
  providerName: z.string(),
  vaultReady: z.boolean(),
  configured: z.boolean(),
  status: z.enum(["connected", "failed", "not_configured"]),
  /** The label the administrator gave this credential. */
  name: z.string().nullable(),
  /** Last four characters of the stored key; the key itself is never returned. */
  keyHint: z.string().nullable(),
  projectName: z.string().nullable(),
  projectNumber: z.string().nullable(),
  lastError: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  /** How many registry models belong to this provider (they are deleted with it). */
  modelCount: z.number().int(),
  /** The administrator confirmed the provider account is on a paid plan. Models can't be used for chat before that. */
  billingConfirmed: z.boolean(),
});
export type ModelProviderStatus = z.infer<typeof ModelProviderStatus>;

export const ProviderModel = z.object({
  /** Full resource name, e.g. "models/gemini-2.5-flash". */
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  inputTokenLimit: z.number().nullable(),
  outputTokenLimit: z.number().nullable(),
  methods: z.array(z.string()),
  /** False when the provider lists the model but refuses it for this project. */
  usable: z.boolean().optional(),
});
export type ProviderModel = z.infer<typeof ProviderModel>;

export const ProviderEndpointCheck = z.object({
  id: z.string(),
  label: z.string(),
  method: z.enum(["GET", "POST"]),
  path: z.string(),
  status: z.enum(["ok", "failed", "skipped"]),
  httpStatus: z.number().nullable(),
  ms: z.number().nullable(),
  detail: z.string().nullable(),
});
export type ProviderEndpointCheck = z.infer<typeof ProviderEndpointCheck>;

export const ProviderDiagnostics = z.object({
  checkedAt: z.string(),
  /** Why the model list couldn't be read, when it couldn't. */
  modelsError: z.string().nullable(),
  models: z.array(ProviderModel),
  endpoints: z.array(ProviderEndpointCheck),
});
export type ProviderDiagnostics = z.infer<typeof ProviderDiagnostics>;

/** Across every organization: what each provider and model cost this period (system administrators only). */
export const SystemModelUsage = z.object({
  period: Period,
  byProvider: z.array(UsageByProvider.extend({ people: z.number().int() })),
  byModel: z.array(UsageByModel.extend({ people: z.number().int() })),
});
export type SystemModelUsage = z.infer<typeof SystemModelUsage>;

// ---- Assistant replies ("turns") ----

export const TurnStatus = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type TurnStatus = z.infer<typeof TurnStatus>;

/** Why a reply didn't happen, as a code the screen turns into a sentence in the person's language. */
export const TurnErrorCode = z.enum([
  "no_model",
  "model_unavailable",
  "model_refused",
  "provider_rejected",
  "rate_limited",
  "overloaded",
  "unreachable",
  "timeout",
  "blocked",
  "empty",
  "interrupted",
  "internal",
]);
export type TurnErrorCode = z.infer<typeof TurnErrorCode>;

export const TurnState = z.object({
  turnId: z.string(),
  status: TurnStatus,
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  errorCode: TurnErrorCode.nullable(),
});
export type TurnState = z.infer<typeof TurnState>;

/** What the live stream of one conversation carries: pieces of the reply as it is written, and status changes. */
export const TurnStreamItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), turnId: z.string(), n: z.number().int(), text: z.string() }),
  z.object({ type: z.literal("status"), state: TurnState }),
  /** The assistant is using one of the person's connected apps. */
  z.object({
    type: z.literal("tool"),
    turnId: z.string(),
    app: z.string(),
    tool: z.string(),
    status: z.enum(["running", "done", "failed"]),
  }),
]);
export type TurnStreamItem = z.infer<typeof TurnStreamItem>;

/** A page the assistant made for a conversation, with how many versions it has. */
export const ArtifactSummary = z.object({
  id: z.string(),
  threadId: z.string(),
  title: z.string(),
  /** The newest version number. */
  version: z.number().int(),
  versions: z.array(z.object({ version: z.number().int(), createdAt: z.string() })),
  updatedAt: z.string(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummary>;

export const ArtifactDetail = z.object({
  id: z.string(),
  title: z.string(),
  /** The version whose page is returned. */
  version: z.number().int(),
  html: z.string(),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetail>;
