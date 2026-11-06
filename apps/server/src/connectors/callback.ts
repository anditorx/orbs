import type { Context } from "hono";
import { auth } from "../auth.ts";
import { env } from "../env.ts";
import { ConnectorError, completeAuthorization } from "./service.ts";

/**
 * Where a provider sends the browser back after the user approves (or denies) access.
 * Approving hands the code straight to the Connections page, which finishes the connection while showing
 * that it is working (finishing takes a few seconds, and a bare callback address would just sit blank).
 * A denial or an error is settled here and ends in a redirect with the outcome in the query string.
 */
export async function handleOAuthCallback(c: Context) {
  const base = `${env.ORBS_WEB_URL.replace(/\/$/, "")}/customize/mcp`;
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.redirect(`${env.ORBS_WEB_URL.replace(/\/$/, "")}/login`);
  const q = new URL(c.req.url).searchParams;
  const state = q.get("state");
  const code = q.get("code");
  if (state && code && !q.get("error")) {
    const next = new URLSearchParams({ oauth_state: state, oauth_code: code });
    const iss = q.get("iss");
    if (iss) next.set("oauth_iss", iss);
    return c.redirect(`${base}?${next.toString()}`);
  }
  try {
    const done = await completeAuthorization({
      state: q.get("state"),
      code: q.get("code"),
      iss: q.get("iss"),
      error: q.get("error"),
      userId: session.user.id,
    });
    return c.redirect(`${base}?connected=${encodeURIComponent(done.provider)}`);
  } catch (error) {
    const code = error instanceof ConnectorError ? error.code : "upstream";
    if (code === "upstream" || code === "exchange_failed") console.error("[connector callback]", error);
    return c.redirect(`${base}?connection_error=${encodeURIComponent(code)}`);
  }
}
