/**
 * Decides whether a person-supplied MCP server address is safe to contact from the server.
 * Without this, "add a server" would let anyone make Orbs call internal services (cloud metadata,
 * databases, the admin API) and read the answers back: server-side request forgery (SSRF).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(readonly reason: "invalid" | "scheme" | "credentials" | "private" | "unresolved") {
    super(reason);
  }
}

/** True for loopback, private, link-local, carrier-grade NAT, multicast, documentation and metadata ranges. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("ff") ||
      lower.startsWith("2001:db8")
    );
  }
  return true; // not an IP address at all: treat as unsafe
}

/** Syntax-only checks: https, no embedded credentials, and no literal private IP. */
export function parseServerUrl(raw: string, opts: { allowPrivate?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("invalid");
  }
  if (url.protocol !== "https:" && !(opts.allowPrivate && url.protocol === "http:"))
    throw new UnsafeUrlError("scheme");
  if (url.username || url.password) throw new UnsafeUrlError("credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!opts.allowPrivate) {
    if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError("private");
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      host.endsWith(".local")
    )
      throw new UnsafeUrlError("private");
  }
  return url;
}

/** Full check, including DNS: every address the name resolves to must be public. */
export async function assertSafeServerUrl(
  raw: string,
  opts: { allowPrivate?: boolean; resolve?: (host: string) => Promise<string[]> } = {},
): Promise<URL> {
  const url = parseServerUrl(raw, opts);
  if (opts.allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return url;
  const resolve =
    opts.resolve ?? (async (h: string) => (await lookup(h, { all: true })).map((r) => r.address));
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new UnsafeUrlError("unresolved");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("unresolved");
  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError("private");
  return url;
}
