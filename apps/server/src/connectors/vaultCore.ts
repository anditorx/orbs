import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts secrets (OAuth client secrets, access and refresh tokens) before they reach the database.
 *
 * AES-256-GCM with a random 96-bit nonce per value. Every value is bound to its owner through the
 * additional authenticated data (AAD), e.g. "connection|<org>|<user>|asana|refresh": copying a
 * ciphertext to another row, user or purpose makes decryption fail instead of leaking a token.
 *
 * Stored format: `v1.<nonce>.<tag>.<ciphertext>` (base64url), versioned so the scheme can change later.
 */
const VERSION = "v1";
const b64 = (b: Buffer) => b.toString("base64url");

export interface Vault {
  encrypt(plain: string, aad: string): string;
  decrypt(blob: string, aad: string): string;
}

export function createVault(key: Buffer): Vault {
  if (key.length !== 32) throw new Error("Vault key must be 32 bytes");
  return {
    encrypt(plain, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
    },
    decrypt(blob, aad) {
      const [version, iv, tag, ct] = blob.split(".");
      if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unsupported secret format");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      // Throws if the key, the AAD or the data differ from what was encrypted.
      return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}

/** AAD builders: one place defines what each secret is bound to. */
export const aad = {
  clientSecret: (provider: string) => `connector_app|${provider}|client_secret`,
  providerKey: (provider: string) => `model_provider|${provider}|api_key`,
  customToken: (id: string) => `custom_mcp_server|${id}|token`,
  userClientSecret: (userId: string, provider: string) =>
    `user_connector_app|${userId}|${provider}|client_secret`,
  accessToken: (orgId: string, userId: string, provider: string) =>
    `connection|${orgId}|${userId}|${provider}|access`,
  refreshToken: (orgId: string, userId: string, provider: string) =>
    `connection|${orgId}|${userId}|${provider}|refresh`,
  codeVerifier: (state: string) => `oauth_pending|${state}|verifier`,
};
