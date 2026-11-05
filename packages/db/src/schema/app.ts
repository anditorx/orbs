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

/**
 * Admin-managed model catalog read by the Auto router. `maxDataClass` is the most
 * sensitive data classification this model may receive.
 */
export const modelCatalog = pgTable(
  "model_catalog",
  {
    id: id(),
    orgId: orgId(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    inputUsdPerMtok: numeric("input_usd_per_mtok", { precision: 12, scale: 6 }),
    outputUsdPerMtok: numeric("output_usd_per_mtok", { precision: 12, scale: 6 }),
    qualityScore: real("quality_score"),
    maxDataClass: text("max_data_class", { enum: ["public", "internal", "confidential"] })
      .notNull()
      .default("internal"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("model_catalog_org_model_uq").on(t.orgId, t.provider, t.modelId)],
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
