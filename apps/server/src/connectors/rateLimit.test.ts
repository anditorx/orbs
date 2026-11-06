import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit.ts";

describe("rate limiter", () => {
  it("allows up to the limit, then says when to retry", () => {
    const rl = createRateLimiter(3, 1000);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 100).ok).toBe(true);
    expect(rl.take("a", 200).ok).toBe(true);
    const blocked = rl.take("a", 300);
    expect(blocked).toEqual({ ok: false, retryAfterMs: 700 });
  });
  it("frees slots as the window slides", () => {
    const rl = createRateLimiter(1, 1000);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 999).ok).toBe(false);
    expect(rl.take("a", 1000).ok).toBe(true);
  });
  it("counts keys separately and can forget one", () => {
    const rl = createRateLimiter(1, 1000);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("b", 0).ok).toBe(true);
    rl.forget("a");
    expect(rl.take("a", 1).ok).toBe(true);
  });
  it("does not count blocked attempts", () => {
    const rl = createRateLimiter(1, 1000);
    rl.take("a", 0);
    for (let i = 1; i < 50; i++) rl.take("a", i);
    expect(rl.take("a", 1000).ok).toBe(true);
  });
});
