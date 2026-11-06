import { serve } from "@hono/node-server";
import { RPCHandler } from "@orpc/server/fetch";
import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamBus } from "./agent/streamBus.ts";
import { startWorker } from "./agent/worker.ts";
import { assertCanLeaveOrganization, auth, INVITATION_HEADER } from "./auth.ts";
import { isBlockedAuthPath } from "./blockedAuthPaths.ts";
import { handleOAuthCallback } from "./connectors/callback.ts";
import { env } from "./env.ts";
import { eventBus } from "./events.ts";
import { LANG_HEADER, parseLang, runWithLang, t } from "./i18n.ts";
import { router } from "./rpc/router.ts";

const rpc = new RPCHandler(router);
const app = new Hono();

app.use("*", logger());
// Make the caller's language available to every handler and auth hook for this request.
app.use("*", (c, next) => runWithLang(parseLang(c.req.header(LANG_HEADER)), next));
app.use(
  "/api/*",
  cors({
    origin: env.ORBS_WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", INVITATION_HEADER, LANG_HEADER],
  }),
);
app.use(
  "/rpc/*",
  cors({
    origin: env.ORBS_WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", LANG_HEADER],
  }),
);

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/api/connections/oauth/callback", handleOAuthCallback);
app.use("/api/auth/*", async (c, next) => {
  if (isBlockedAuthPath(new URL(c.req.url).pathname)) {
    return c.json({ message: t("http.blocked") }, 403);
  }
  if (c.req.method === "POST" && new URL(c.req.url).pathname === "/api/auth/organization/leave") {
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as { organizationId?: string } | null;
    if (body?.organizationId) {
      try {
        await assertCanLeaveOrganization(c.req.raw.headers, body.organizationId);
      } catch (error) {
        if (error instanceof APIError) return c.json({ message: error.message }, 400);
        throw error;
      }
    }
  }
  await next();
});
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/rpc",
    context: { headers: c.req.raw.headers },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

await eventBus.start();
await streamBus.start();
// Replies are written inside this process for now; the worker only talks to the database, so it can move out later.
startWorker();
serve({ fetch: app.fetch, port: env.ORBS_SERVER_PORT }, (info) => {
  console.log(`orbs-server listening on http://localhost:${info.port}`);
});
