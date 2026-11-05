/**
 * Recovery tool for self-hosted installs: grant or revoke the system administrator role.
 *   pnpm --filter @orbs/server admin:promote someone@company.co.id
 *   pnpm --filter @orbs/server admin:demote  someone@company.co.id
 */
import { createDatabase, schema } from "@orbs/db";
import { eq, sql } from "drizzle-orm";

const [mode, emailArg] = process.argv.slice(2);
if ((mode !== "promote" && mode !== "demote") || !emailArg) {
  console.error("usage: set-system-role.ts <promote|demote> <email>");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const { db, sql: client } = createDatabase(url);
const role = mode === "promote" ? "admin" : "user";
const updated = await db
  .update(schema.user)
  .set({ role })
  .where(eq(sql`lower(${schema.user.email})`, emailArg.trim().toLowerCase()))
  .returning({ id: schema.user.id, email: schema.user.email });
await db.insert(schema.auditLog).values({
  action: `system.role.${mode}`,
  targetType: "user",
  targetId: updated[0]?.id ?? null,
  metadata: { via: "cli", email: emailArg },
});
await client.end();
if (updated.length === 0) {
  console.error(`no user with email ${emailArg}`);
  process.exit(1);
}
console.log(`${updated[0]?.email} is now ${role === "admin" ? "a system administrator" : "a regular user"}`);
