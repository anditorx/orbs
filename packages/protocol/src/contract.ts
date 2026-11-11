import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  AdminConnector,
  AdminModel,
  AdminModelInput,
  AdminModelPatch,
  AdminOrg,
  AdminOrgDetail,
  AdminUser,
  ArtifactDetail,
  ArtifactSummary,
  AuditEntry,
  BudgetInput,
  BudgetStatus,
  ConnectorAccount,
  ConnectorProviderStatus,
  ConnectorTool,
  Customization,
  CustomizationInput,
  CustomizationKind,
  CustomizationPatch,
  CustomMcpServer,
  CustomMcpTool,
  Engine,
  EngineOption,
  FileContent,
  Me,
  Mode,
  ModelProviderStatus,
  OrbsEvent,
  OrgModelRow,
  Period,
  Project,
  ProjectFileEntry,
  ProviderDiagnostics,
  ProviderModel,
  SystemModelUsage,
  SystemRole,
  TeamUsage,
  Thread,
  TurnState,
  TurnStreamItem,
  UsageSummary,
  UserUsageDetail,
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
    /** Posts a message and queues the assistant's reply. `engine` (if given) becomes the conversation's engine. */
    postMessage: oc
      .input(
        z.object({
          threadId: z.string(),
          text: z.string().trim().min(1).max(20_000),
          engine: Engine.optional(),
        }),
      )
      .output(z.object({ eventId: z.string(), seq: z.number().int(), turnId: z.string() })),
    rename: oc
      .input(z.object({ threadId: z.string(), title: z.string().trim().min(1).max(200) }))
      .output(Thread),
    /** Permanently deletes a conversation and its messages (creator or org owner/admin). */
    delete: oc.input(z.object({ threadId: z.string() })).output(z.object({ deleted: z.literal(true) })),
  },
  /** The assistant's replies: whether one is being written, stopping it, and watching it arrive. */
  /** Pages the assistant made (dashboards). Only the conversation's owner may read them. */
  artifacts: {
    list: oc.input(z.object({ threadId: z.string() })).output(z.array(ArtifactSummary)),
    get: oc
      .input(z.object({ artifactId: z.string(), version: z.number().int().min(1).optional() }))
      .output(ArtifactDetail),
  },
  turns: {
    /** The reply being queued or written for this conversation right now, if any. */
    active: oc.input(z.object({ threadId: z.string() })).output(TurnState.nullable()),
    cancel: oc.input(z.object({ threadId: z.string() })).output(z.object({ ok: z.literal(true) })),
    /** Pieces of the reply as it is written, and status changes. Only the conversation's owner receives them. */
    watch: oc.input(z.object({ threadId: z.string() })).output(eventIterator(TurnStreamItem)),
  },
  /** Projects: Code-mode workspaces whose files are uploaded from the user's machine. */
  projects: {
    list: oc.input(z.object({ mode: Mode.optional() })).output(z.array(Project)),
    create: oc
      .input(z.object({ name: z.string().trim().min(1).max(200), mode: Mode.default("code") }))
      .output(Project),
    /** Renames a project (its creator or a company admin). */
    rename: oc
      .input(z.object({ projectId: z.string(), name: z.string().trim().min(1).max(200) }))
      .output(z.object({ ok: z.literal(true) })),
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
  /** System administration — requires a system administrator (user.role = "system.admin"). */
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
            /** Put the new account straight into a company, with this company role. */
            orgId: z.string().optional(),
            orgRole: z.enum(["org.admin", "org.member"]).default("org.member"),
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
      /** Sets a new password and signs the account out everywhere. */
      setPassword: oc
        .input(z.object({ userId: z.string(), password: z.string().min(8).max(200) }))
        .output(z.object({ ok: z.literal(true) })),
      setEmail: oc
        .input(z.object({ userId: z.string(), email: z.string().trim().email() }))
        .output(z.object({ ok: z.literal(true) })),
      /** Permanently deletes an account. Its usage history is kept. */
      delete: oc.input(z.object({ userId: z.string() })).output(z.object({ ok: z.literal(true) })),
    },
    orgs: {
      list: oc.output(z.array(AdminOrg)),
      /** Creates an empty company; the system admin does not become a member. */
      create: oc
        .input(z.object({ name: z.string().trim().min(1).max(200) }))
        .output(z.object({ id: z.string() })),
      detail: oc.input(z.object({ orgId: z.string() })).output(AdminOrgDetail),
      rename: oc
        .input(z.object({ orgId: z.string(), name: z.string().trim().min(1).max(200) }))
        .output(z.object({ ok: z.literal(true) })),
      /** `confirmName` must equal the company name exactly. */
      delete: oc
        .input(z.object({ orgId: z.string(), confirmName: z.string() }))
        .output(z.object({ ok: z.literal(true) })),
      /** Makes this company the system admin's active workspace, without becoming a member. */
      enter: oc.input(z.object({ orgId: z.string() })).output(z.object({ ok: z.literal(true) })),
      invite: oc
        .input(
          z.object({
            orgId: z.string(),
            email: z.string().trim().email(),
            role: z.enum(["org.admin", "org.member"]),
          }),
        )
        .output(z.object({ invitationId: z.string() })),
      setMemberRole: oc
        .input(
          z.object({ orgId: z.string(), memberId: z.string(), role: z.enum(["org.admin", "org.member"]) }),
        )
        .output(z.object({ ok: z.literal(true) })),
      removeMember: oc
        .input(z.object({ orgId: z.string(), memberId: z.string() }))
        .output(z.object({ ok: z.literal(true) })),
    },
    /** Model registry (system-wide) and which models each organization gets. */
    models: {
      list: oc.output(z.array(AdminModel)),
      create: oc.input(AdminModelInput).output(z.object({ id: z.string() })),
      update: oc
        .input(z.object({ id: z.string(), patch: AdminModelPatch }))
        .output(z.object({ ok: z.literal(true) })),
      delete: oc.input(z.object({ id: z.string() })).output(z.object({ ok: z.literal(true) })),
      /** Every registry model with this organization's assignment state. */
      forOrg: oc.input(z.object({ orgId: z.string() })).output(z.array(OrgModelRow)),
      /** `assigned` = appears for the organization; `enabled` = usable there. */
      setForOrg: oc
        .input(
          z.object({
            orgId: z.string(),
            modelId: z.string(),
            assigned: z.boolean(),
            enabled: z.boolean().default(true),
          }),
        )
        .output(z.object({ ok: z.literal(true) })),
    },
    /** OAuth apps for external connectors, and which organizations may use them. */
    /** What every provider and model cost this month, across all organizations. */
    modelUsage: oc.input(z.object({ period: Period.optional() })).output(SystemModelUsage),
    /** Credentials for AI model providers such as Gemini. Keys are write-only. */
    providers: {
      list: oc.output(z.array(ModelProviderStatus)),
      /** Re-verifies every stored key with its provider and returns the live state (reused for 10 seconds). */
      check: oc.output(z.array(ModelProviderStatus)),
      /** Saves the credentials and checks them. Leave `apiKey` empty to keep the stored key. */
      save: oc
        .input(
          z.object({
            provider: z.string(),
            name: z.string().trim().max(100).optional(),
            apiKey: z.string().max(500).optional(),
            projectName: z.string().trim().max(200).optional(),
            projectNumber: z.string().trim().max(40).optional(),
            billingConfirmed: z.boolean().optional(),
          }),
        )
        .output(ModelProviderStatus),
      test: oc.input(z.object({ provider: z.string() })).output(ModelProviderStatus),
      /**
       * Sets one model from the provider's list. `listed` ("Active") puts it in the model lists (creating its
       * registry entry the first time); `enabled` says whether it can be chosen.
       */
      setModel: oc
        .input(
          z.object({
            provider: z.string(),
            modelId: z.string().min(1).max(200),
            listed: z.boolean().optional(),
            enabled: z.boolean().optional(),
          }),
        )
        .output(z.object({ ok: z.literal(true) })),
      /** The administrator states (or withdraws) that the provider account is on a paid plan. */
      setBilling: oc
        .input(z.object({ provider: z.string(), confirmed: z.boolean() }))
        .output(z.object({ ok: z.literal(true) })),
      /** Only the models the stored key can use (no probing, no tokens). */
      models: oc.input(z.object({ provider: z.string() })).output(z.array(ProviderModel)),
      /** Lists the models the stored key can use and probes every endpoint family. Uses a few tokens. */
      diagnose: oc.input(z.object({ provider: z.string() })).output(ProviderDiagnostics),
      /** Removes the credentials and, with them, every model registered under the provider. */
      remove: oc
        .input(z.object({ provider: z.string() }))
        .output(z.object({ ok: z.literal(true), modelsRemoved: z.number().int() })),
    },
    connectors: {
      list: oc.output(z.array(AdminConnector)),
      /** Stores the app's credentials (the secret is write-only). */
      setApp: oc
        .input(
          z.object({
            provider: z.string(),
            clientId: z.string().trim().min(1).max(300),
            clientSecret: z.string().min(1).max(500),
          }),
        )
        .output(z.object({ ok: z.literal(true) })),
      /** Removes the app and disconnects everyone who used it. */
      clearApp: oc.input(z.object({ provider: z.string() })).output(z.object({ ok: z.literal(true) })),
    },
    audit: {
      list: oc
        .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
        .output(z.array(AuditEntry)),
    },
  },
  /** The current user's connections to external services (MCP connectors such as Asana). */
  connections: {
    list: oc.output(z.array(ConnectorProviderStatus)),
    /**
     * Returns the provider URL the browser must open to authorize. Normally the provider sends the person back to Orbs.
     * With `mode: "code"` it shows a code instead, for a provider that refuses Orbs' address; `state` then lets `finish`
     * complete the attempt.
     */
    start: oc
      .input(z.object({ provider: z.string(), mode: z.enum(["redirect", "code"]).optional() }))
      .output(z.object({ url: z.string(), state: z.string().optional() })),
    /** Completes an authorization with the code the provider showed. Single use, like the redirect. */
    finish: oc
      .input(
        z.object({
          state: z.string().min(1).max(200),
          code: z.string().trim().min(1).max(2000),
          /** The `iss` the provider sent back with a redirect; a pasted code has none. */
          iss: z.string().max(500).optional(),
        }),
      )
      .output(z.object({ provider: z.string() })),
    /** Connects with a pasted token instead of the sign-in flow. The token is checked first and stored encrypted. */
    connectWithToken: oc
      .input(z.object({ provider: z.string(), token: z.string().trim().min(1).max(4000) }))
      .output(ConnectorAccount),
    /** The workspaces behind a token connection and which the assistant may use. `choosable` is false with a single one. */
    workspaces: oc.input(z.object({ provider: z.string() })).output(
      z.object({
        choosable: z.boolean(),
        workspaces: z.array(z.object({ gid: z.string(), name: z.string(), enabled: z.boolean() })),
      }),
    ),
    /** Chooses the workspaces the assistant may use (at least one). */
    setWorkspaces: oc
      .input(z.object({ provider: z.string(), gids: z.array(z.string().max(40)).min(1).max(50) }))
      .output(z.object({ chosen: z.number() })),
    /** Calls a read-only tool to prove the connection works and refresh the account details. */
    test: oc.input(z.object({ provider: z.string() })).output(ConnectorAccount),
    tools: oc.input(z.object({ provider: z.string() })).output(z.array(ConnectorTool)),
    /** MCP servers the person added themselves. They belong to the person alone. */
    custom: {
      list: oc.output(z.array(CustomMcpServer)),
      add: oc
        .input(
          z.object({
            name: z.string().trim().min(1).max(60),
            url: z.string().trim().min(1).max(2000),
            /** Optional bearer token; stored encrypted and never returned. */
            token: z.string().max(4000).optional(),
          }),
        )
        .output(CustomMcpServer),
      remove: oc.input(z.object({ id: z.string() })).output(z.object({ ok: z.literal(true) })),
      tools: oc.input(z.object({ id: z.string() })).output(z.array(CustomMcpTool)),
      /** Switches exactly these tools on; everything else stays blocked. */
      setAllowed: oc
        .input(z.object({ id: z.string(), tools: z.array(z.string().max(200)).max(500) }))
        .output(z.object({ allowed: z.array(z.string()) })),
      call: oc
        .input(
          z.object({
            id: z.string(),
            tool: z.string().min(1).max(200),
            args: z.record(z.string(), z.unknown()).default({}),
          }),
        )
        .output(z.object({ text: z.string(), truncated: z.boolean(), isError: z.boolean() })),
    },
    /** Registers the person's own OAuth app (the secret is write-only). Replaces any earlier one. */
    setOwnApp: oc
      .input(
        z.object({
          provider: z.string(),
          appName: z.string().trim().min(1).max(100),
          description: z.string().trim().max(300).optional(),
          clientId: z.string().trim().min(1).max(300),
          /** Leave out to keep the one already stored. */
          clientSecret: z.string().trim().min(1).max(500).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    clearOwnApp: oc.input(z.object({ provider: z.string() })).output(z.object({ ok: z.literal(true) })),
    /** Runs one read-only tool. Orbs refuses anything its policy doesn't allow, and limits how often. */
    call: oc
      .input(
        z.object({
          provider: z.string(),
          tool: z.string().min(1).max(100),
          args: z.record(z.string(), z.unknown()).default({}),
        }),
      )
      .output(z.object({ text: z.string(), truncated: z.boolean(), isError: z.boolean() })),
    disconnect: oc.input(z.object({ provider: z.string() })).output(z.object({ revoked: z.boolean() })),
  },
  /** Pin or unpin a conversation or a project for the current user. */
  pins: {
    set: oc
      .input(z.object({ kind: z.enum(["thread", "project"]), id: z.string(), pinned: z.boolean() }))
      .output(z.object({ ok: z.literal(true) })),
  },
  /** Usage & budgets. `mine` is for everyone; the rest need an org owner/admin. */
  usage: {
    mine: oc.input(z.object({ period: Period.optional() })).output(UsageSummary),
    team: oc
      .input(z.object({ period: Period.optional(), projectId: z.string().nullable().default(null) }))
      .output(TeamUsage),
    userDetail: oc.input(z.object({ userId: z.string(), period: Period.optional() })).output(UserUsageDetail),
    /** Non-destructive: only usage after the reset counts toward budgets. */
    reset: oc
      .input(
        z.object({
          userId: z.string(),
          projectId: z.string().nullable().default(null),
          reason: z.string().trim().max(500).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    budgets: {
      list: oc.output(z.array(BudgetStatus)),
      /** Creates or updates the budget with the same user, project and unit. */
      set: oc.input(BudgetInput).output(z.object({ id: z.string() })),
      delete: oc.input(z.object({ id: z.string() })).output(z.object({ ok: z.literal(true) })),
    },
    settings: {
      get: oc.output(z.object({ fxUsdIdr: z.number() })),
      set: oc
        .input(z.object({ fxUsdIdr: z.number().min(1000).max(100_000) }))
        .output(z.object({ fxUsdIdr: z.number() })),
    },
  },
  customizations: {
    list: oc.input(z.object({ kind: CustomizationKind.optional() })).output(z.array(Customization)),
    create: oc.input(CustomizationInput).output(Customization),
    update: oc.input(z.object({ id: z.string(), patch: CustomizationPatch })).output(Customization),
    delete: oc.input(z.object({ id: z.string() })).output(z.object({ deleted: z.literal(true) })),
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
