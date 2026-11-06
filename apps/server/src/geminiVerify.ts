/** `transient`: a passing problem (network, timeout, provider overload), not a verdict on the key itself. */
export type VerifyResult = { ok: true } | { ok: false; error: string; transient?: boolean };

const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";

/** Lists one model with the key: cheap, free, and it fails clearly when the key is wrong. */
export async function verifyGemini(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  modelsUrl = GEMINI_MODELS_URL,
): Promise<VerifyResult> {
  try {
    const res = await fetchImpl(modelsUrl, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (res.ok) return { ok: true };
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Not JSON; keep the status line.
    }
    // The provider could echo part of the request back; never let the key into a stored message.
    return {
      ok: false,
      error: message.split(apiKey).join("[key]").slice(0, 300),
      transient: res.status >= 500 || res.status === 429,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.name : "error";
    return {
      ok: false,
      error: reason === "TimeoutError" ? "Timed out" : "Could not reach the provider",
      transient: true,
    };
  }
}
