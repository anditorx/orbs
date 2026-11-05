import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ORBS_SERVER_PORT: z.coerce.number().int().default(8787),
  ORBS_WEB_URL: z.string().url().default("http://localhost:5173"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:8787"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** open | invite-only | domain (see src/signupPolicy.ts). */
  ORBS_SIGNUP_MODE: z.enum(["open", "invite-only", "domain"]).default("open"),
  /** Comma-separated email domains allowed when ORBS_SIGNUP_MODE=domain. */
  ORBS_SIGNUP_DOMAINS: z.string().optional(),
  /** Where workspace files are stored. Defaults to <repo>/.data for local development. */
  ORBS_DATA_DIR: z.string().default(new URL("../../../.data", import.meta.url).pathname),
  ORBS_UPLOAD_MAX_FILE_MB: z.coerce.number().positive().default(10),
  ORBS_PROJECT_MAX_MB: z.coerce.number().positive().default(500),
  ORBS_PROJECT_MAX_FILES: z.coerce.number().int().positive().default(20_000),
});

export const env = EnvSchema.parse(process.env);

if (env.ORBS_SIGNUP_MODE === "domain" && !env.ORBS_SIGNUP_DOMAINS?.trim()) {
  throw new Error("ORBS_SIGNUP_MODE=domain requires ORBS_SIGNUP_DOMAINS (e.g. company.co.id)");
}
export type Env = typeof env;
