/**
 * How "Automatic" picks a model: among the models people can actually use, the cheapest one, with the quality score
 * (when set) and then the name breaking ties so the choice never flips between runs.
 */
export interface Candidate {
  provider: string;
  modelId: string;
  /** Usable right now: connected provider, billing confirmed, priced, enabled. */
  available: boolean;
  inputUsdPerMtok: number | null;
  outputUsdPerMtok: number | null;
  qualityScore: number | null;
}

/** Input counts three times as much as output: the history sent with every message outweighs a short reply. */
const blended = (c: Candidate) => ((c.inputUsdPerMtok ?? 0) * 3 + (c.outputUsdPerMtok ?? 0)) / 4;

export function pickAutoModel(candidates: Candidate[]): Candidate | undefined {
  return candidates
    .filter((c) => c.available && c.inputUsdPerMtok !== null && c.outputUsdPerMtok !== null)
    .sort(
      (a, b) =>
        blended(a) - blended(b) ||
        (b.qualityScore ?? 0) - (a.qualityScore ?? 0) ||
        `${a.provider}/${a.modelId}`.localeCompare(`${b.provider}/${b.modelId}`),
    )[0];
}
