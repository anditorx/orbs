# Orbs

**Open-source, self-hostable AI agent workspace for teams.** One app for everyday work
(_Kerja_ mode, friendly for non-technical people) and for software development (_Kode_ mode,
IDE-like). Teams build skills and plugins, publish them to their workspace, and connect other
platforms through MCP. Data stays on the company's own infrastructure.

> Status: **Phase 0 — foundations.** Sign-up, workspaces (organizations), conversations (create,
> delete) with a live event stream, a System Admin console, and Code-mode project folders (upload,
> browse, view files) work. The agent itself, connectors and plugins arrive in later phases.
> See the [roadmap](#roadmap) below.

## Highlights (planned)

- **Mesin (engine) picker:** _Otomatis_ (cost- and policy-aware model router), a specific model,
  or an external coding agent (Claude Code, Codex, …) through a harness adapter.
- **Plugins & skills:** build by chat or form, review and publish to your team, versioned.
- **MCP connectors:** one-click OAuth, credentials kept server-side in an encrypted vault.
- **Enterprise-ready:** multi-tenant data model, SSO (OIDC), roles, audit log, data classification.

## Quick start (local development)

Requirements: Node 24+, Docker, Corepack.

```bash
corepack enable
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d postgres
pnpm db:migrate
pnpm dev                        # server :8787, web :5173
```

Open http://localhost:5173, create an account, then create your workspace.

**System administrators.** The first account on a fresh install becomes the system administrator
and sees **Admin Sistem** (users, organizations, audit log). To grant or revoke it from the
command line (e.g. to recover access):

```bash
pnpm --filter @orbs/server admin:promote someone@company.co.id
pnpm --filter @orbs/server admin:demote  someone@company.co.id
```

For a company install, restrict sign-up in `.env`: `ORBS_SIGNUP_MODE=invite-only` (only invited
emails) or `ORBS_SIGNUP_MODE=domain` with `ORBS_SIGNUP_DOMAINS=company.co.id`. The first account is
always allowed so an administrator can bootstrap a fresh install.

## Repository layout

| Path                  | Purpose                                                        | License  |
| --------------------- | -------------------------------------------------------------- | -------- |
| `apps/server`         | API (Hono + oRPC), auth (Better-Auth), event log & live stream | AGPL-3.0 |
| `apps/web`            | React UI (Vite, TanStack Router/Query, Tailwind)               | AGPL-3.0 |
| `apps/runner`         | Agent runner (skeleton; executes turns in later phases)        | AGPL-3.0 |
| `packages/db`         | Drizzle schema & migrations (Postgres)                         | AGPL-3.0 |
| `packages/protocol`   | API contract & canonical event schemas (Zod)                   | MIT      |
| `packages/plugin-sdk` | Plugin manifest schema & helpers                               | MIT      |

## Architecture notes

- **Event log first.** Writes append rows to `event`; a Postgres trigger broadcasts each insert
  with `NOTIFY`, and every API instance streams matching events to subscribed clients
  (oRPC event iterator over HTTP). This keeps multiple server instances in sync.
- **Multi-tenant from day one.** Every tenant-owned table has `org_id`, so a self-hosted install
  can later become a SaaS without a schema rewrite.

## Roadmap
1. **Foundations** — workspaces, conversations, admin, Code-mode projects, app shell *(done)*
2. **Composer & activity timeline** — `@` mentions, `/` commands, attachments, queued messages
3. **Agent & automatic engine** — first working agent, admin model catalog, cost-aware router
4. **MCP connectors** — one-click OAuth, encrypted credential vault, audit
5. **Skills & plugins** — build by chat or form, team registry with admin review
6. **Team security** — SSO (OIDC), roles, data classification, PII redaction, local models
7. **Code mode** — editor, diff, terminal and coding agents in a sandbox
8. **Desktop app** — Electron, local folders, auto-update

## License

Core under [AGPL-3.0-only](LICENSE); protocol and plugin SDK under MIT. See `CONTRIBUTING.md`.
