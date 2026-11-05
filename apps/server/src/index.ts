import { serve } from "@hono/node-server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth, INVITATION_HEADER } from "./auth.ts";
import { env } from "./env.ts";
import { eventBus } from "./events.ts";
import { router } from "./rpc/router.ts";

const rpc = new RPCHandler(router);
const app = new Hono();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: env.ORBS_WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", INVITATION_HEADER],
  }),
);
app.use(
  "/rpc/*",
  cors({ origin: env.ORBS_WEB_URL, credentials: true, allowHeaders: ["Content-Type", "Authorization"] }),
);

app.get("/healthz", (c) => c.json({ ok: true }));
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
serve({ fetch: app.fetch, port: env.ORBS_SERVER_PORT }, (info) => {
  console.log(`orbs-server listening on http://localhost:${info.port}`);
});
