import { schema } from "@orbs/db";
import {
  type Engine,
  type EngineOption,
  isOrgAdmin,
  isSystemAdmin,
  ORG_ROLE,
  type OrbsEvent,
  type Thread,
} from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { audit } from "../audit.ts";
import { db } from "../db.ts";
import { appendEvent, createEventVisibility, eventBus, listVisibleEvents } from "../events.ts";
import { assertWithinBudget } from "../usage.ts";
import { adminRouter } from "./admin.ts";
import { authed, inOrg, os } from "./base.ts";
import { customizationsRouter } from "./customizations.ts";
import { projectsRouter } from "./projects.ts";
import { usageRouter } from "./usage.ts";

function toThread(row: typeof schema.thread.$inferSelect): Thread {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    mode: row.mode,
    engine: row.engine as Engine,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const EXTERNAL_AGENTS: Array<{ harness: "claude-code" | "codex" | "opencode" | "pi"; label: string }> = [
  { harness: "claude-code", label: "Claude Code" },
  { harness: "codex", label: "Codex" },
  { harness: "opencode", label: "OpenCode" },
  { harness: "pi", label: "Pi" },
];

export const router = os.router({
  health: os.health.handler(() => ({ ok: true, version: "0.0.0" })),

  me: authed.me.handler(async ({ context }) => {
    const orgId = context.session.activeOrganizationId ?? null;
    let role: string | null = null;
    let activeOrgName: string | null = null;
    if (orgId) {
      const [org] = await db
        .select({ name: schema.organization.name })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId))
        .limit(1);
      activeOrgName = org?.name ?? null;
      const [membership] = await db
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, context.user.id)))
        .limit(1);
      // A system admin who entered a company without joining it acts as its administrator.
      role = membership?.role ?? (org && isSystemAdmin(context.user.role) ? ORG_ROLE.admin : null);
    }
    return {
      user: { id: context.user.id, name: context.user.name, email: context.user.email },
      activeOrgId: orgId,
      role,
      isSystemAdmin: isSystemAdmin(context.user.role),
      activeOrgName,
    };
  }),

  admin: adminRouter,

  projects: projectsRouter,

  usage: usageRouter,

  customizations: customizationsRouter,

  engines: {
    list: inOrg.engines.list.handler(async ({ context }) => {
      const models = await db
        .select()
        .from(schema.modelCatalog)
        .where(and(eq(schema.modelCatalog.orgId, context.orgId), eq(schema.modelCatalog.enabled, true)));
      const options: EngineOption[] = [
        {
          engine: { kind: "auto" },
          label: "Otomatis",
          description: "Orbs memilih model yang paling hemat dan cukup pintar untuk tiap permintaan.",
          available: models.length > 0,
          ...(models.length > 0 ? {} : { reason: "Admin belum menambahkan model ke katalog." }),
        },
        ...models.map(
          (m): EngineOption => ({
            engine: { kind: "model", provider: m.provider, modelId: m.modelId },
            label: m.displayName,
            description: `${m.provider} · data maks: ${m.maxDataClass}`,
            available: true,
          }),
        ),
        ...EXTERNAL_AGENTS.map(
          (a): EngineOption => ({
            engine: { kind: "agent", harness: a.harness },
            label: a.label,
            description: "Agent coding eksternal lewat harness adapter (mode Kode).",
            available: false,
            reason: "Belum tersedia — direncanakan di Fase 5.",
          }),
        ),
      ];
      return { options };
    }),
  },

  threads: {
    list: inOrg.threads.list.handler(async ({ context, input }) => {
      const rows = await db
        .select()
        .from(schema.thread)
        // Conversations are private: members only ever see their own.
        .where(and(eq(schema.thread.orgId, context.orgId), eq(schema.thread.createdBy, context.user.id)))
        .orderBy(desc(schema.thread.updatedAt))
        .limit(input.limit);
      return rows.map(toThread);
    }),

    create: inOrg.threads.create.handler(async ({ context, input }) => {
      if (input.projectId) {
        const [project] = await db
          .select({ id: schema.project.id })
          .from(schema.project)
          .where(and(eq(schema.project.id, input.projectId), eq(schema.project.orgId, context.orgId)))
          .limit(1);
        if (!project) throw new ORPCError("NOT_FOUND", { message: "Proyek tidak ditemukan" });
      }
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.thread)
          .values({
            orgId: context.orgId,
            title: input.title,
            mode: input.mode,
            engine: input.engine,
            projectId: input.projectId ?? null,
            createdBy: context.user.id,
          })
          .returning();
        if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
        await appendEvent(
          {
            orgId: context.orgId,
            streamType: "thread",
            streamId: row.id,
            type: "thread.created",
            payload: { title: row.title, mode: row.mode, engine: input.engine },
            actorId: context.user.id,
          },
          tx,
        );
        return toThread(row);
      });
    }),

    postMessage: inOrg.threads.postMessage.handler(async ({ context, input }) => {
      const [thread] = await db
        .select({ projectId: schema.thread.projectId })
        .from(schema.thread)
        .where(
          and(
            eq(schema.thread.id, input.threadId),
            eq(schema.thread.orgId, context.orgId),
            eq(schema.thread.createdBy, context.user.id),
          ),
        )
        .limit(1);
      if (!thread) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
      // Refuse new work once a monthly budget (global or for this project) is used up.
      await assertWithinBudget(context.orgId, context.user.id, thread.projectId);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.thread)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(schema.thread.id, input.threadId),
              eq(schema.thread.orgId, context.orgId),
              eq(schema.thread.createdBy, context.user.id),
            ),
          )
          .returning({ id: schema.thread.id });
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
        const event = await appendEvent(
          {
            orgId: context.orgId,
            streamType: "thread",
            streamId: row.id,
            type: "message.posted",
            payload: { role: "user", text: input.text },
            actorId: context.user.id,
          },
          tx,
        );
        return { eventId: event.id, seq: event.seq };
      });
    }),

    rename: inOrg.threads.rename.handler(async ({ context, input }) => {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.thread)
          .set({ title: input.title })
          .where(
            and(
              eq(schema.thread.id, input.threadId),
              eq(schema.thread.orgId, context.orgId),
              eq(schema.thread.createdBy, context.user.id),
            ),
          )
          .returning();
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Percakapan tidak ditemukan" });
        await appendEvent(
          {
            orgId: context.orgId,
            streamType: "org",
            streamId: context.orgId,
            type: "thread.renamed",
            payload: { threadId: row.id, title: row.title, ownerId: context.user.id },
            actorId: context.user.id,
          },
          tx,
        );
        return toThread(row);
      });
    }),

    delete: inOrg.threads.delete.handler(async ({ context, input }) => {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: schema.thread.id, title: schema.thread.title, createdBy: schema.thread.createdBy })
          .from(schema.thread)
          .where(and(eq(schema.thread.id, input.threadId), eq(schema.thread.orgId, context.orgId)))
          .limit(1);
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Percakapan tidak ditemukan" });
        if (row.createdBy !== context.user.id && !isOrgAdmin(context.role)) {
          throw new ORPCError("FORBIDDEN", {
            message: "Hanya pembuat atau admin yang bisa menghapus percakapan ini",
          });
        }
        // Hard delete: the thread's own event stream holds message content, so it goes too.
        await tx
          .delete(schema.event)
          .where(
            and(
              eq(schema.event.orgId, context.orgId),
              eq(schema.event.streamType, "thread"),
              eq(schema.event.streamId, row.id),
            ),
          );
        await tx.delete(schema.thread).where(eq(schema.thread.id, row.id));
        // Org-level event so other open tabs drop the conversation from their lists.
        await appendEvent(
          {
            orgId: context.orgId,
            streamType: "org",
            streamId: context.orgId,
            type: "thread.deleted",
            payload: { threadId: row.id, ownerId: row.createdBy },
            actorId: context.user.id,
          },
          tx,
        );
        await audit(
          {
            orgId: context.orgId,
            actorId: context.user.id,
            action: "thread.delete",
            targetType: "thread",
            targetId: row.id,
          },
          tx,
        );
        return { deleted: true as const };
      });
    }),
  },

  events: {
    list: inOrg.events.list.handler(({ context, input }) =>
      listVisibleEvents(context.orgId, context.user.id, input.streamType, input.streamId, input.afterSeq),
    ),

    subscribe: inOrg.events.subscribe.handler(async function* ({ context, input, signal }) {
      const queue: OrbsEvent[] = [];
      const visible = createEventVisibility(context.orgId, context.user.id);
      let wake: (() => void) | undefined;
      const unsubscribe = eventBus.subscribe((event) => {
        if (event.orgId !== context.orgId) return;
        if (input.streamType && event.streamType !== input.streamType) return;
        if (input.streamId && event.streamId !== input.streamId) return;
        const { orgId: _orgId, ...rest } = event;
        queue.push(rest);
        wake?.();
      });
      // One abort listener per connection (not per wait), released when the stream ends.
      const onAbort = () => wake?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!signal?.aborted) {
          const next = queue.shift();
          if (next) {
            if (await visible(next)) yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        unsubscribe();
      }
    }),
  },
});

export type AppRouter = typeof router;
