import { env } from "../env.ts";
import { createVault, type Vault } from "./vaultCore.ts";

export { aad, type Vault } from "./vaultCore.ts";

let shared: Vault | null = null;

/** True when ORBS_SECRET_KEY is set, i.e. connectors can store credentials. */
export function vaultReady(): boolean {
  return Boolean(env.ORBS_SECRET_KEY);
}

/** The installation-wide vault. Throws a clear error when no key is configured. */
export function vault(): Vault {
  if (!env.ORBS_SECRET_KEY) throw new Error("ORBS_SECRET_KEY is not set; connectors can't store credentials");
  shared ??= createVault(Buffer.from(env.ORBS_SECRET_KEY, "base64"));
  return shared;
}
