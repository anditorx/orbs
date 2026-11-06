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
  /**
   * 32-byte key (base64) that encrypts connector credentials at rest, e.g. `openssl rand -base64 32`.
   * Losing it makes stored connections unreadable; changing it forces everyone to reconnect.
   */
  ORBS_SECRET_KEY: z
    .string()
    .optional()
    .refine(
      (v) => !v || Buffer.from(v, "base64").length === 32,
      "ORBS_SECRET_KEY must be 32 bytes, base64-encoded",
    ),
  /** Calls per minute one person may make through one connection (protects the provider's rate limit). */
  ORBS_CONNECTOR_RATE_PER_MIN: z.coerce.number().int().positive().default(60),
  /** Allow custom MCP servers on private/local addresses and plain http. Only for trusted self-hosted setups. */
  ORBS_ALLOW_PRIVATE_MCP_URLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Overrides the Gemini API address. Only for tests against a local mock; leave unset in production. */
  ORBS_GEMINI_API_URL: z.string().url().optional(),
  /** Overrides Asana's MCP endpoint. Only for tests against a local mock; leave unset in production. */
  ORBS_ASANA_MCP_URL: z.string().url().optional(),
  /** Overrides Asana's REST API address (token connections). Only for tests against a local mock. */
  ORBS_ASANA_API_URL: z.string().url().optional(),
});

export const env = EnvSchema.parse(process.env);

if (env.ORBS_SIGNUP_MODE === "domain" && !env.ORBS_SIGNUP_DOMAINS?.trim()) {
  throw new Error("ORBS_SIGNUP_MODE=domain requires ORBS_SIGNUP_DOMAINS (e.g. company.co.id)");
}
export type Env = typeof env;
