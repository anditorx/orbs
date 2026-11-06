/**
 * Published list prices, kept only to suggest a starting point when an administrator fills in a model's price.
 * They are references, never applied automatically, and they go stale: each entry says when it was checked.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (paid tier, standard, text). Re-check before relying on them.
 */
export interface ReferencePrice {
  /** USD per 1 million input tokens. */
  input: number;
  /** USD per 1 million output tokens, or null when the model has no output charge (embeddings). */
  output: number | null;
  /** The day the price was read from the provider's page. */
  checked: string;
  /** Where to confirm it. */
  url: string;
  /** Short caveat, as a message key the screen translates. */
  noteKey?: "ref.note.longPrompts" | "ref.note.audio" | "ref.note.embedding";
}

const GEMINI_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";
const CHECKED = "2026-11-06";

const GEMINI: Record<string, Omit<ReferencePrice, "checked" | "url">> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, noteKey: "ref.note.audio" },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  // Above 200k prompt tokens the price is higher ($2.50 in, $15.00 out); the standard tier is suggested here.
  "gemini-2.5-pro": { input: 1.25, output: 10, noteKey: "ref.note.longPrompts" },
  "gemini-embedding-001": { input: 0.15, output: null, noteKey: "ref.note.embedding" },
};

/** The published price of a model, if one is saved here; undefined otherwise (nothing is guessed). */
export function referencePriceFor(provider: string, modelId: string): ReferencePrice | undefined {
  if (provider !== "gemini") return undefined;
  const entry = GEMINI[modelId];
  return entry ? { ...entry, checked: CHECKED, url: GEMINI_PRICING } : undefined;
}

/** Where to look a price up for a provider, even when no reference price is saved for the model. */
export function pricingPageFor(provider: string): string | undefined {
  return provider === "gemini" ? GEMINI_PRICING : undefined;
}

export type PriceFloorResult = { ok: true } | { ok: false; field: "input" | "output"; min: number };

/**
 * A model's price may not be lower than the provider's own published price, so using it can never cost more than
 * it brings in. An empty price counts as zero, which is lower. Models with no saved reference price have no floor
 * (nothing is guessed), and an embedding model's missing output price is fine because there is no output charge.
 */
export function checkPriceFloor(
  provider: string,
  modelId: string,
  input: number | null,
  output: number | null,
): PriceFloorResult {
  const ref = referencePriceFor(provider, modelId);
  if (!ref) return { ok: true };
  // A hair of tolerance so 0.1 typed as 0.10000000000000001 still counts as equal.
  const below = (value: number | null, min: number) => (value ?? 0) < min - 1e-9;
  if (below(input, ref.input)) return { ok: false, field: "input", min: ref.input };
  if (ref.output !== null && below(output, ref.output))
    return { ok: false, field: "output", min: ref.output };
  return { ok: true };
}

/**
 * Whether a model's price has been filled in well enough for its use to be counted. With a published reference
 * price it must also not be below it; without one, both prices must simply be present. An unpriced model would
 * run for free in the reports, so it is not offered for chat until this holds.
 */
export function priceIsSet(
  provider: string,
  modelId: string,
  input: number | null,
  output: number | null,
): boolean {
  if (referencePriceFor(provider, modelId)) return checkPriceFloor(provider, modelId, input, output).ok;
  return input !== null && output !== null;
}
