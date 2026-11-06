import { describe, expect, it } from "vitest";
import { assertSafeServerUrl, isPrivateAddress, parseServerUrl, UnsafeUrlError } from "./urlGuard.ts";

const reason = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
    return "ok";
  } catch (e) {
    return e instanceof UnsafeUrlError ? e.reason : "other";
  }
};

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ])("%s is private", (a) => expect(isPrivateAddress(a)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "93.184.216.34", "2606:4700::1111"])(
    "%s is public",
    (a) => expect(isPrivateAddress(a)).toBe(false),
  );
});

describe("parseServerUrl", () => {
  it("requires https and rejects embedded credentials", async () => {
    expect(await reason(() => parseServerUrl("http://example.com/mcp"))).toBe("scheme");
    expect(await reason(() => parseServerUrl("ftp://example.com"))).toBe("scheme");
    expect(await reason(() => parseServerUrl("https://user:pw@example.com/mcp"))).toBe("credentials");
    expect(await reason(() => parseServerUrl("not a url"))).toBe("invalid");
    expect(await reason(() => parseServerUrl("https://example.com/mcp"))).toBe("ok");
  });
  it("rejects literal private addresses and internal names", async () => {
    for (const u of [
      "https://127.0.0.1/mcp",
      "https://[::1]/mcp",
      "https://169.254.169.254/latest",
      "https://localhost/mcp",
      "https://db.internal/mcp",
      "https://printer.local/mcp",
    ])
      expect(await reason(() => parseServerUrl(u))).toBe("private");
  });
  it("can allow private http for trusted self-hosted setups", async () => {
    expect(await reason(() => parseServerUrl("http://127.0.0.1:8799/mcp", { allowPrivate: true }))).toBe(
      "ok",
    );
  });
});

describe("assertSafeServerUrl", () => {
  it("rejects names that resolve to a private address, even one of several", async () => {
    expect(
      await reason(
        assertSafeServerUrl("https://evil.example/mcp", { resolve: async () => ["8.8.8.8", "10.0.0.5"] }),
      ),
    ).toBe("private");
    expect(
      await reason(
        assertSafeServerUrl("https://evil.example/mcp", { resolve: async () => ["169.254.169.254"] }),
      ),
    ).toBe("private");
  });
  it("accepts names that resolve only to public addresses", async () => {
    expect(
      await reason(assertSafeServerUrl("https://ok.example/mcp", { resolve: async () => ["93.184.216.34"] })),
    ).toBe("ok");
  });
  it("reports names that don't resolve", async () => {
    expect(
      await reason(
        assertSafeServerUrl("https://nx.example/mcp", {
          resolve: async () => {
            throw new Error("ENOTFOUND");
          },
        }),
      ),
    ).toBe("unresolved");
    expect(await reason(assertSafeServerUrl("https://nx.example/mcp", { resolve: async () => [] }))).toBe(
      "unresolved",
    );
  });
});
