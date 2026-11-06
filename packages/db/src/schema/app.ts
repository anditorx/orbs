// Orbs application tables. Every tenant-owned row carries `orgId` so a single
// deployment can later host many organizations (SaaS) without a schema rewrite.
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const orgId = () =>
  text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** A container for conversations: a Work project or a Code repository. */
export const project = pgTable(
  "project",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    mode: text("mode", { enum: ["work", "code"] })
      .notNull()
      .default("work"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("project_org_idx").on(t.orgId)],
);

/**
 * Index of files stored in a project's workspace. Bytes live in workspace storage
 * (local disk today, S3-compatible later); this table drives listing, quotas and audit.
 */
export const projectFile = pgTable(
  "project_file",
  {
    id: id(),
    orgId: orgId(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("project_file_path_uq").on(t.projectId, t.path),
    index("project_file_org_idx").on(t.orgId),
  ],
);

/** One conversation with an agent. */
export const thread = pgTable(
  "thread",
  {
    id: id(),
    orgId: orgId(),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    mode: text("mode", { enum: ["work", "code"] })
      .notNull()
      .default("work"),
    /** Engine selection ("Mesin"): auto router, a specific model, or an external agent. */
    engine: jsonb("engine").notNull().default(sql`'{"kind":"auto"}'::jsonb`),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("thread_org_updated_idx").on(t.orgId, t.updatedAt)],
);

/**
 * Append-only event log. Projections (thread, project, ...) are derived from or
 * written alongside these events; `seq` gives a global, gap-tolerant order.
 */
export const event = pgTable(
  "event",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: text("id")
      .notNull()
      .unique()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: orgId(),
    streamType: text("stream_type").notNull(),
    streamId: text("stream_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    actorId: text("actor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_stream_idx").on(t.orgId, t.streamType, t.streamId, t.seq)],
);

/** Security-relevant actions, kept separately from domain events for retention/export. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: text("org_id").references(() => organization.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_created_idx").on(t.orgId, t.createdAt)],
);

/** Free-form per-organization settings (feature flags, policies, defaults). */
export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
});

/**
 * Append-only record of model usage, one row per model call. It is deliberately NOT derived
 * from the event stream: deleting a thread removes its events, but cost history must survive.
 * `userId`/`projectId`/`threadId` are plain text (no FK) so deleting them never erases the cost trail.
 * Cost is frozen at write time (`costMicroUsd` + the `fxRate` used) so later price or
 * exchange-rate changes never rewrite history.
 */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: orgId(),
    // Plain text, no FK: removing an account must never erase its cost history.
    userId: text("user_id").notNull(),
    projectId: text("project_id"),
    threadId: text("thread_id"),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }).notNull().default(0),
    /** Cost in millionths of a US dollar (integer math, no float drift). */
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    /** IDR per USD used when this row was written. */
    fxRate: numeric("fx_rate", { precision: 14, scale: 4 }).notNull(),
    costIdr: bigint("cost_idr", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("usage_org_user_created_idx").on(t.orgId, t.userId, t.createdAt),
    index("usage_org_project_created_idx").on(t.orgId, t.projectId, t.createdAt),
  ],
);

/**
 * "Reset" of a user's quota. Non-destructive: usage rows stay in the ledger, but only rows
 * created after the latest applicable reset count toward budgets. `projectId` null = all projects.
 */
export const usageReset = pgTable(
  "usage_reset",
  {
    id: id(),
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    resetBy: text("reset_by").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason"),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_reset_lookup_idx").on(t.orgId, t.userId, t.resetAt)],
);

/**
 * Monthly spending cap. `userId` null = default for every member; `projectId` null = across all
 * projects. A user-specific budget overrides the org default with the same project and unit.
 */
export const budget = pgTable(
  "budget",
  {
    id: id(),
    orgId: orgId(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    unit: text("unit", { enum: ["tokens", "idr"] }).notNull(),
    limitValue: bigint("limit_value", { mode: "number" }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("budget_org_idx").on(t.orgId)],
);

/**
 * User-authored instructions, skills (SKILL.md body) and plugins (manifest JSON body).
 * `scope` "user" is private to `ownerId`; "org" is shared with the whole workspace (admins only).
 * `projectId` null = applies everywhere; otherwise only inside that project.
 */
export const customization = pgTable(
  "customization",
  {
    id: id(),
    orgId: orgId(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["instruction", "skill", "plugin"] }).notNull(),
    scope: text("scope", { enum: ["user", "org"] })
      .notNull()
      .default("user"),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    body: text("body").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customization_org_kind_idx").on(t.orgId, t.kind)],
);

/**
 * A user's pinned conversations and projects. Pins are personal (projects are shared, so a project
 * pin only changes the order for the person who pinned it). `targetId` has no FK: it points at a
 * thread or a project depending on `kind`, and stale pins are removed when the target is deleted.
 */
export const userPin = pgTable(
  "user_pin",
  {
    id: id(),
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["thread", "project"] }).notNull(),
    targetId: text("target_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_pin_uq").on(t.userId, t.kind, t.targetId)],
);

/**
 * System-wide registry of AI models, managed by Orbs system administrators. `active` is a global
 * switch: an inactive model is unusable in every organization.
 */
export const aiModel = pgTable(
  "ai_model",
  {
    id: id(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    inputUsdPerMtok: numeric("input_usd_per_mtok", { precision: 12, scale: 6 }),
    outputUsdPerMtok: numeric("output_usd_per_mtok", { precision: 12, scale: 6 }),
    qualityScore: real("quality_score"),
    /** The most sensitive data classification this model may receive. */
    maxDataClass: text("max_data_class", { enum: ["public", "internal", "confidential"] })
      .notNull()
      .default("internal"),
    /** "Enabled": whether the model can be used / chosen. Off = shown greyed out. */
    active: boolean("active").notNull().default(true),
    /** "Active": whether the model appears in the model lists at all. */
    listed: boolean("listed").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_model_provider_model_uq").on(t.provider, t.modelId)],
);

/**
 * Per-organization overrides of the registry. Every listed model appears in every organization by default;
 * a row changes that for one organization: `hidden` removes the model from its list, `enabled = false`
 * keeps it visible but not selectable. No row means "follow the global setting".
 */
export const orgModel = pgTable(
  "org_model",
  {
    id: id(),
    orgId: orgId(),
    modelRefId: text("model_ref_id")
      .notNull()
      .references(() => aiModel.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    /** This organization doesn't see the model at all (it appears everywhere else by default). */
    hidden: boolean("hidden").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("org_model_uq").on(t.orgId, t.modelRefId)],
);

// ---- External connections (MCP connectors) ----

/**
 * OAuth app credentials for a connector, set once per installation by a system administrator.
 * The secret is encrypted at rest (see connectors/vault.ts) and is never returned by the API.
 */
export const connectorApp = pgTable(
  "connector_app",
  {
    id: id(),
    provider: text("provider").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("connector_app_provider_uq").on(t.provider)],
);

/**
 * A person's own OAuth app for a connector. When present it is used instead of the installation's app,
 * so people can register their own app without waiting for a system administrator.
 */
export const userConnectorApp = pgTable(
  "user_connector_app",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    /** Labels the person gave their app, to recognize it later. Not sent to the provider. */
    appName: text("app_name"),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("user_connector_app_uq").on(t.userId, t.provider)],
);

/**
 * One user's authorized connection to an external service. Tokens are encrypted with the vault key,
 * bound to (organization, user, provider), and never leave the server.
 */
export const connection = pgTable(
  "connection",
  {
    id: id(),
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status", { enum: ["active", "needs_reauth"] })
      .notNull()
      .default("active"),
    accountName: text("account_name"),
    accountEmail: text("account_email"),
    workspaceName: text("workspace_name"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Authorization server issuer that issued these credentials; never reused with another issuer. */
    issuer: text("issuer"),
    /** OAuth `resource` the tokens were requested for. */
    resource: text("resource"),
    /**
     * The workspaces of the account the person allowed the assistant to use, by id and name. Null means they never
     * chose, so every workspace the account has is used. Only a token connection can span several workspaces.
     */
    allowedWorkspaces: jsonb("allowed_workspaces").$type<Array<{ gid: string; name: string }>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("connection_uq").on(t.orgId, t.userId, t.provider)],
);

/** Short-lived record of an OAuth authorization in progress (CSRF `state` + PKCE verifier). Single use. */
export const oauthPending = pgTable("oauth_pending", {
  state: text("state").primaryKey(),
  orgId: orgId(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  codeVerifierEnc: text("code_verifier_enc").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  issuer: text("issuer"),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/**
 * An MCP server a person added themselves (any address, not one of Orbs' built-in services).
 * It belongs to that person alone. The optional bearer token is encrypted, and `allowedTools` lists the
 * tools the person explicitly switched on: nothing a custom server offers runs by default.
 */
export const customMcpServer = pgTable(
  "custom_mcp_server",
  {
    id: id(),
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    tokenEnc: text("token_enc"),
    allowedTools: jsonb("allowed_tools").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_mcp_server_name_uq").on(t.orgId, t.userId, t.name)],
);

/**
 * Credentials for an AI model provider (for example Gemini), set once per installation by a system
 * administrator. The API key is encrypted at rest and never returned by the API.
 */
export const modelProvider = pgTable(
  "model_provider",
  {
    id: id(),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    apiKeyEnc: text("api_key_enc").notNull(),
    /** Last four characters of the key, so an admin can tell which key is stored. */
    keyHint: text("key_hint").notNull(),
    projectName: text("project_name"),
    projectNumber: text("project_number"),
    /** "connected" after a successful check, "failed" after a rejected one. */
    status: text("status").notNull().default("failed").$type<"connected" | "failed">(),
    lastError: text("last_error"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /**
     * The administrator states the provider account is on a paid, billing-enabled plan. Free plans may use prompts
     * to improve the provider's products, so models stay unavailable for chat until this is confirmed.
     */
    billingConfirmed: boolean("billing_confirmed").notNull().default(false),
    /** Consecutive background checks that failed for a passing reason (network, timeout, provider overload). */
    failStreak: integer("fail_streak").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("model_provider_provider_uq").on(t.provider)],
);

/**
 * One reply the assistant owes for a message. It is the durable queue the agent worker takes work from, and the
 * record of what happened to it, so a restart can't leave a conversation stuck "typing" forever.
 */
export const turn = pgTable(
  "turn",
  {
    id: id(),
    orgId: orgId(),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    /** What the person asked for when sending ("Automatic" or one model). */
    engine: jsonb("engine").notNull(),
    /** The model that actually answered (resolved when the turn starts). */
    provider: text("provider"),
    modelId: text("model_id"),
    errorCode: text("error_code"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Touched while the worker is alive; a running turn that stops beating is declared interrupted. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("turn_thread_created_idx").on(t.threadId, t.createdAt),
    index("turn_status_idx").on(t.status, t.createdAt),
  ],
);
