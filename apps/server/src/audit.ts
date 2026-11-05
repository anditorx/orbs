import { schema } from "@orbs/db";
import { db } from "./db.ts";

/** Records a security-relevant action. Never put conversation content in `metadata`. */
export async function audit(
  entry: {
    orgId?: string | null;
    actorId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
  tx: Pick<typeof db, "insert"> = db,
) {
  await tx.insert(schema.auditLog).values({
    orgId: entry.orgId ?? null,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  });
}
