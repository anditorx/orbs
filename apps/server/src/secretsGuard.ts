/**
 * The example environment file is public, so any value copied from it is known to everyone. A real deployment must
 * never run on one: an auth secret that anyone can read lets them forge a session for any account.
 */
const PLACEHOLDER = /change-?me|replace-?me|your-secret|example|changeme|please-32b/i;

export function isPlaceholderSecret(value: string | undefined): boolean {
  return Boolean(value) && PLACEHOLDER.test(value as string);
}

/**
 * Throws when a secret is still the published placeholder and the server runs in production; in development it only
 * returns a warning, so a fresh checkout works but nobody forgets to change it.
 */
export function checkSecrets(values: { BETTER_AUTH_SECRET: string }, nodeEnv: string | undefined): string[] {
  const warnings: string[] = [];
  if (isPlaceholderSecret(values.BETTER_AUTH_SECRET)) {
    const message =
      "BETTER_AUTH_SECRET is still the placeholder from .env.example. Generate your own: openssl rand -base64 32";
    if (nodeEnv === "production") throw new Error(message);
    warnings.push(message);
  }
  return warnings;
}
