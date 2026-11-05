import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export { schema };
export type Database = ReturnType<typeof createDatabase>["db"];

/** Creates the query client used by the app and a raw client for LISTEN/NOTIFY. */
export function createDatabase(url: string) {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql };
}
