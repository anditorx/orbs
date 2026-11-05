import { schema } from "@orbs/db";
import {
  type BudgetStatus,
  type BudgetUnit,
  checkBudget,
  costMicroUsd,
  DEFAULT_FX_USD_IDR,
  microUsdToIdr,
  periodOf,
  periodRange,
  resolveBudgets,
  type UsageByDay,
  type UsageByModel,
  type UsageByProject,
  type UsageByThread,
  type UsageTotals,
} from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import { db } from "./db.ts";

const L = schema.usageLedger;

export function resolvePeriod(period: string | undefined) {
  const key = period ?? periodOf(new Date());
  return { key, ...periodRange(key) };
}

export async function getFxRate(orgId: string): Promise<number> {
  const [row] = await db
    .select({ data: schema.orgSettings.data })
    .from(schema.orgSettings)
    .where(eq(schema.orgSettings.orgId, orgId))
    .limit(1);
  const fx = (row?.data as { fxUsdIdr?: unknown } | undefined)?.fxUsdIdr;
  return typeof fx === "number" && fx > 0 ? fx : DEFAULT_FX_USD_IDR;
}

export interface UsageRecord {
  orgId: string;
  userId: string;
  projectId?: string | null;
  threadId?: string | null;
  provider: string;
  modelId: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
}

/**
 * Appends one model call to the usage ledger, freezing price and exchange rate at write time.
 * The agent loop (Phase 3) must call this once per model response, including failed/aborted
 * turns that already consumed tokens. Unknown models are recorded with zero cost, not dropped.
 */
export async function recordUsage(record: UsageRecord) {
  const [model] = await db
    .select({ input: schema.modelCatalog.inputUsdPerMtok, output: schema.modelCatalog.outputUsdPerMtok })
    .from(schema.modelCatalog)
    .where(
      and(
        eq(schema.modelCatalog.orgId, record.orgId),
        eq(schema.modelCatalog.provider, record.provider),
        eq(schema.modelCatalog.modelId, record.modelId),
      ),
    )
    .limit(1);
  const fx = await getFxRate(record.orgId);
  const micro = costMicroUsd(record, {
    inputUsdPerMtok: Number(model?.input ?? 0),
    outputUsdPerMtok: Number(model?.output ?? 0),
  });
  await db.insert(L).values({
    orgId: record.orgId,
    userId: record.userId,
    projectId: record.projectId ?? null,
    threadId: record.threadId ?? null,
    provider: record.provider,
    modelId: record.modelId,
    inputTokens: record.inputTokens,
    cachedInputTokens: record.cachedInputTokens ?? 0,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens ?? 0,
    costMicroUsd: micro,
    fxRate: String(fx),
    costIdr: microUsdToIdr(micro, fx),
  });
}

// ---- Reporting (true usage, unaffected by resets) ----

// Cached tokens are a subset of input and reasoning tokens a subset of output, so neither is added again.
const TOTAL_TOKENS = sql<number>`coalesce(sum(${L.inputTokens} + ${L.outputTokens}), 0)::float8`;
const COST_IDR = sql<number>`coalesce(sum(${L.costIdr}), 0)::float8`;
const REQUESTS = sql<number>`count(*)::int`;

function scope(
  orgId: string,
  period: { start: Date; end: Date },
  f: { userId?: string; projectId?: string | null },
) {
  const conds: SQL[] = [eq(L.orgId, orgId), gte(L.createdAt, period.start), lt(L.createdAt, period.end)];
  if (f.userId) conds.push(eq(L.userId, f.userId));
  if (f.projectId) conds.push(eq(L.projectId, f.projectId));
  return and(...conds);
}

async function projectNames(orgId: string) {
  const rows = await db
    .select({ id: schema.project.id, name: schema.project.name })
    .from(schema.project)
    .where(eq(schema.project.orgId, orgId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function totalsFor(
  orgId: string,
  period: { start: Date; end: Date },
  f: { userId?: string; projectId?: string | null } = {},
): Promise<UsageTotals> {
  const [row] = await db
    .select({
      requests: REQUESTS,
      inputTokens: sql<number>`coalesce(sum(${L.inputTokens}), 0)::float8`,
      cachedInputTokens: sql<number>`coalesce(sum(${L.cachedInputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${L.outputTokens}), 0)::float8`,
      reasoningTokens: sql<number>`coalesce(sum(${L.reasoningTokens}), 0)::float8`,
      costIdr: COST_IDR,
    })
    .from(L)
    .where(scope(orgId, period, f));
  const t = row ?? {
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costIdr: 0,
  };
  return { ...t, totalTokens: t.inputTokens + t.outputTokens };
}

export async function byProject(
  orgId: string,
  period: { start: Date; end: Date },
  f: { userId?: string } = {},
): Promise<UsageByProject[]> {
  const [rows, names] = await Promise.all([
    db
      .select({ projectId: L.projectId, requests: REQUESTS, totalTokens: TOTAL_TOKENS, costIdr: COST_IDR })
      .from(L)
      .where(scope(orgId, period, f))
      .groupBy(L.projectId)
      .orderBy(sql`2 desc`),
    projectNames(orgId),
  ]);
  return rows.map((r) => ({
    ...r,
    // Deleted projects keep their usage but lose their name.
    projectName: r.projectId ? (names.get(r.projectId) ?? null) : null,
  }));
}

export async function byModel(
  orgId: string,
  period: { start: Date; end: Date },
  f: { userId?: string; projectId?: string | null } = {},
): Promise<UsageByModel[]> {
  return db
    .select({
      provider: L.provider,
      modelId: L.modelId,
      requests: REQUESTS,
      totalTokens: TOTAL_TOKENS,
      costIdr: COST_IDR,
    })
    .from(L)
    .where(scope(orgId, period, f))
    .groupBy(L.provider, L.modelId)
    .orderBy(sql`5 desc`);
}

export async function byDay(
  orgId: string,
  period: { start: Date; end: Date },
  f: { userId?: string } = {},
): Promise<UsageByDay[]> {
  const day = sql<string>`to_char(${L.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;
  return db
    .select({ day, totalTokens: TOTAL_TOKENS, costIdr: COST_IDR })
    .from(L)
    .where(scope(orgId, period, f))
    .groupBy(day)
    .orderBy(day);
}

export async function byThread(
  orgId: string,
  period: { start: Date; end: Date },
  f: { userId: string },
): Promise<UsageByThread[]> {
  const [rows, names] = await Promise.all([
    db
      .select({
        threadId: L.threadId,
        projectId: sql<string | null>`max(${L.projectId})`,
        requests: REQUESTS,
        totalTokens: TOTAL_TOKENS,
        costIdr: COST_IDR,
        lastAt: sql<string>`max(${L.createdAt})`,
      })
      .from(L)
      .where(scope(orgId, period, f))
      .groupBy(L.threadId)
      .orderBy(sql`max(${L.createdAt}) desc`)
      .limit(200),
    projectNames(orgId),
  ]);
  return rows.map((r) => ({
    ...r,
    // Conversation titles are private to their owner and never shown in admin reports.
    title: null,
    projectName: r.projectId ? (names.get(r.projectId) ?? null) : null,
    lastAt: new Date(r.lastAt).toISOString(),
  }));
}

export async function totalsByUser(
  orgId: string,
  period: { start: Date; end: Date },
  projectId: string | null,
) {
  return db
    .select({
      userId: L.userId,
      requests: REQUESTS,
      totalTokens: TOTAL_TOKENS,
      costIdr: COST_IDR,
    })
    .from(L)
    .where(scope(orgId, period, { projectId }))
    .groupBy(L.userId);
}

// ---- Budgets (usage counted after resets) ----

/**
 * Usage that counts toward budgets: only rows newer than the latest applicable reset
 * (a reset with no project covers everything; a project reset covers that project's rows).
 */
async function countedUsage(
  orgId: string,
  period: { start: Date; end: Date },
  projectId: string | null,
  userId?: string,
) {
  const rows = await db.execute<{ userId: string; tokens: number; costIdr: number }>(sql`
    select l.user_id as "userId",
           coalesce(sum(l.input_tokens + l.output_tokens), 0)::float8 as tokens,
           coalesce(sum(l.cost_idr), 0)::float8 as "costIdr"
    from usage_ledger l
    where l.org_id = ${orgId}
      and l.created_at >= ${period.start.toISOString()}::timestamptz
      and l.created_at < ${period.end.toISOString()}::timestamptz
      ${projectId ? sql`and l.project_id = ${projectId}` : sql``}
      ${userId ? sql`and l.user_id = ${userId}` : sql``}
      and l.created_at > coalesce(
        (select max(r.reset_at) from usage_reset r
          where r.org_id = l.org_id and r.user_id = l.user_id
            and (r.project_id is null or r.project_id = l.project_id)),
        '-infinity'::timestamptz)
    group by l.user_id`);
  return new Map([...rows].map((r) => [r.userId, r]));
}

export async function loadBudgets(orgId: string) {
  const [rows, names] = await Promise.all([
    db.select().from(schema.budget).where(eq(schema.budget.orgId, orgId)),
    projectNames(orgId),
  ]);
  return rows.map((b) => ({
    id: b.id,
    userId: b.userId,
    projectId: b.projectId,
    projectName: b.projectId ? (names.get(b.projectId) ?? null) : null,
    unit: b.unit as BudgetUnit,
    limit: b.limitValue,
  }));
}

type LoadedBudget = Awaited<ReturnType<typeof loadBudgets>>[number];

/** Budget status per user for the given users, evaluated against counted usage in `period`. */
export async function budgetStatusFor(
  orgId: string,
  period: { start: Date; end: Date },
  userIds: string[],
  budgets?: LoadedBudget[],
): Promise<Map<string, BudgetStatus[]>> {
  const all = budgets ?? (await loadBudgets(orgId));
  const result = new Map<string, BudgetStatus[]>(userIds.map((id) => [id, []]));
  if (all.length === 0) return result;
  // One counted-usage query per distinct project scope, shared by all users.
  const scopes = [...new Set(all.map((b) => b.projectId))];
  const usageByScope = new Map(
    await Promise.all(scopes.map(async (p) => [p, await countedUsage(orgId, period, p)] as const)),
  );
  for (const userId of userIds) {
    const statuses = resolveBudgets(all, userId).map((b): BudgetStatus => {
      const u = usageByScope.get(b.projectId)?.get(userId);
      const used = Math.round(b.unit === "tokens" ? (u?.tokens ?? 0) : (u?.costIdr ?? 0));
      return { ...b, used, ...checkBudget(b.limit, used) };
    });
    result.set(userId, statuses);
  }
  return result;
}

/**
 * Blocks a new request when any budget that applies to this user (global or for this project)
 * is already used up. Checked before a turn starts, so one in-flight turn may overshoot a limit
 * slightly; concurrent turns can too. That overrun is accepted by design (documented in the UI).
 */
export async function assertWithinBudget(orgId: string, userId: string, projectId: string | null) {
  const budgets = (await loadBudgets(orgId)).filter((b) => b.projectId === null || b.projectId === projectId);
  if (budgets.length === 0) return;
  const statuses =
    (await budgetStatusFor(orgId, resolvePeriod(undefined), [userId], budgets)).get(userId) ?? [];
  const hit = statuses.find((s) => s.exceeded);
  if (hit) {
    const where = hit.projectName ? ` untuk proyek "${hit.projectName}"` : "";
    throw new ORPCError("FORBIDDEN", {
      message: `Batas pemakaian bulanan${where} sudah habis. Hubungi admin ruang kerja untuk menambah atau mereset kuota.`,
    });
  }
}
