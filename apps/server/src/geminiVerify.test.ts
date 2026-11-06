import { describe, expect, it } from "vitest";
import { verifyGemini } from "./geminiVerify.ts";

const reply = (status: number, body?: unknown): typeof fetch =>
  (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as typeof fetch;

describe("verifyGemini", () => {
  it("accepts a key the provider accepts, sending it in a header (not the URL)", async () => {
    let seen: { url: string; key: string | null } | undefined;
    const spy: typeof fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen = { url: String(input), key: new Headers(init?.headers).get("x-goog-api-key") };
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    expect(await verifyGemini("AIza-secret", spy)).toEqual({ ok: true });
    expect(seen?.key).toBe("AIza-secret");
    expect(seen?.url).not.toContain("AIza-secret");
  });
  it("reports the provider's reason for rejecting a key", async () => {
    const out = await verifyGemini("bad", reply(400, { error: { message: "API key not valid." } }));
    expect(out).toEqual({ ok: false, error: "API key not valid.", transient: false });
  });
  it("never lets the key into the stored message", async () => {
    const out = await verifyGemini(
      "AIza-secret",
      reply(403, { error: { message: "Key AIza-secret is blocked" } }),
    );
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain("AIza-secret");
  });
  it("falls back to the status when the body isn't JSON, and survives network failure", async () => {
    expect(await verifyGemini("k", reply(500))).toEqual({ ok: false, error: "HTTP 500", transient: true });
    const boom: typeof fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await verifyGemini("k", boom)).toEqual({
      ok: false,
      error: "Could not reach the provider",
      transient: true,
    });
  });

  it("tells a rejected key apart from a passing problem", async () => {
    // A key Google refuses is a verdict; overload, rate limits and network trouble are not.
    expect(
      (await verifyGemini("k", reply(400, { error: { message: "bad" } }))) as { transient?: boolean },
    ).toMatchObject({ transient: false });
    expect(
      (await verifyGemini("k", reply(403, { error: { message: "no" } }))) as { transient?: boolean },
    ).toMatchObject({ transient: false });
    expect(
      (await verifyGemini("k", reply(429, { error: { message: "slow down" } }))) as { transient?: boolean },
    ).toMatchObject({ transient: true });
    expect(
      (await verifyGemini("k", reply(503, { error: { message: "busy" } }))) as { transient?: boolean },
    ).toMatchObject({ transient: true });
  });
});
