import { createDatabase } from "@orbs/db";
import { env } from "./env.ts";

export const { db, sql } = createDatabase(env.DATABASE_URL);
