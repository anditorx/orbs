<div align="center">

# Orbs

**An open-source, self-hostable AI agent workspace for teams.**

[![CI](https://github.com/anditorx/orbs/actions/workflows/ci.yml/badge.svg)](https://github.com/anditorx/orbs/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
![Status: early development](https://img.shields.io/badge/status-early%20development-orange.svg)

</div>

Orbs brings everyday knowledge work and software development into a single, team-friendly
workspace. Non-technical colleagues get a guided **Work** mode; engineers get an IDE-style
**Code** mode. Teams will be able to build skills and plugins, publish them to their workspace,
and connect their existing tools through the Model Context Protocol (MCP) — while all data stays
on infrastructure they control.

> [!NOTE]
> Orbs is in **early development**. The foundations described below are working today; the AI
> agent itself, connectors and plugins are on the [roadmap](#roadmap). Interfaces and data
> structures may change without notice until the first tagged release.

## Contents

- [Why Orbs](#why-orbs)
- [Features](#features)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Administration](#administration)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Security](#security)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why Orbs

- **Your data, your infrastructure.** Orbs is designed to be self-hosted. Conversations, files
  and credentials are stored in your own database and storage.
- **One workspace for everyone.** A plain-language Work mode for operations, finance or sales
  teams, and a Code mode for engineers — in the same product, with shared plugins.
- **Model freedom with cost control.** A planned _Automatic_ engine routes each request to the
  most cost-effective model that is good enough for the task, within your data policy.
- **Built for organizations.** Multi-tenant data model, roles, invitations, a system
  administration console and an audit log from day one.

## Features

### Available today

| Area                      | Capabilities                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accounts & workspaces** | Email/password sign-in, multiple workspaces (organizations) per user, workspace switcher, member roles (`org.admin`, `org.member`)                    |
| **Invitations**           | Shareable invitation links that work without an email server; configurable sign-up policy (`open`, `invite-only`, `domain`)                           |
| **Conversations**         | Create, rename and delete conversations; group them into projects; real-time updates across browser tabs and users                                    |
| **Code mode**             | Upload a project folder (drag-and-drop or picker), browse the file tree and view files; dependency folders and secret files are skipped automatically |
| **System administration** | Console for system administrators: users (create, promote, block), organizations, and an audit log; command-line recovery tools                       |
| **Interface**             | Collapsible sidebar, command palette (`⌘K` / `Ctrl+K`), info panel, light/dark/system themes with accent colors, keyboard shortcuts                   |

### Planned

- **Engine picker** — _Automatic_ (cost- and policy-aware model routing), a specific model, or an
  external coding agent (e.g. Claude Code, Codex) through a harness adapter.
- **Composer & activity timeline** — `@` mentions, `/` commands, attachments, queued messages,
  inline approvals.
- **MCP connectors** — one-click OAuth, credentials held server-side in an encrypted vault.
- **Skills & plugins** — create them by chat or form, publish to a team registry with admin review.
- **Code mode** — editor, diffs, terminal and coding agents running in an isolated sandbox.
- **Desktop app** — Electron client for macOS, Windows and Linux with local-folder access.

> [!NOTE]
> The user interface is currently in **Indonesian**. English localization is planned.

## Architecture

```
┌──────────────────────────┐      HTTPS (RPC + live event stream)      ┌──────────────────────────┐
│ Web client (React)       │ ────────────────────────────────────────▶ │ API server (Node.js)     │
│ Work mode · Code mode    │                                           │ Hono · oRPC · Better Auth│
└──────────────────────────┘                                           └────────────┬─────────────┘
                                                                                    │
                                    ┌───────────────────────────────┬───────────────┴───────────┐
                                    ▼                               ▼                           ▼
                           PostgreSQL (data,               Workspace storage            Agent runner
                           event log, LISTEN/NOTIFY)       (uploaded project files)     (planned)
```

- **Event log first.** Every write appends a row to an append-only `event` table. A Postgres
  trigger broadcasts each insert with `NOTIFY`, and every API instance streams matching events to
  subscribed clients. Multiple server instances therefore stay in sync without extra
  infrastructure.
- **Multi-tenant from day one.** Every tenant-owned table carries an `org_id`, so a self-hosted
  installation can later serve many organizations without a schema rewrite.
- **Contract-first API.** The client–server contract and canonical event schemas live in
  `packages/protocol` (Zod + oRPC), shared by the server and every client.

**Technology:** TypeScript, Node.js 24, pnpm workspaces, Hono, oRPC, Better Auth, Drizzle ORM,
PostgreSQL 16 (pgvector), React 19, Vite, TanStack Router & Query, Tailwind CSS v4, Vitest, Biome.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) **24** or later (see `.nvmrc`)
- [Corepack](https://nodejs.org/api/corepack.html) (bundled with Node.js) for pnpm
- [Docker](https://www.docker.com/) with Docker Compose, for PostgreSQL

### Local setup

```bash
git clone https://github.com/anditorx/orbs.git
cd orbs
corepack enable
pnpm install

cp .env.example .env
# Generate a session secret and paste it into BETTER_AUTH_SECRET in .env
openssl rand -base64 32

pnpm db:up        # start PostgreSQL (localhost:54329)
pnpm db:migrate   # apply database migrations
pnpm dev          # API on http://localhost:8787, web app on http://localhost:5173
```

Open <http://localhost:5173>, create an account and then create your first workspace. The first
account on a fresh installation automatically becomes the **system administrator**.

> [!IMPORTANT]
> A production deployment guide and container images are not yet available. The current setup is
> intended for local development and evaluation.

## Configuration

All settings are read from environment variables (see [`.env.example`](.env.example)).

| Variable                  | Default                 | Description                                                           |
| ------------------------- | ----------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`            | —                       | PostgreSQL connection string. **Required.**                           |
| `BETTER_AUTH_SECRET`      | —                       | Secret used to sign sessions (at least 32 characters). **Required.**  |
| `BETTER_AUTH_URL`         | `http://localhost:8787` | Base URL of the API as seen by the browser.                           |
| `ORBS_WEB_URL`            | `http://localhost:5173` | Origin of the web app (used for CORS and auth redirects).             |
| `ORBS_SERVER_PORT`        | `8787`                  | Port the API server listens on.                                       |
| `ORBS_SIGNUP_MODE`        | `open`                  | Who may create an account: `open`, `invite-only` or `domain`.         |
| `ORBS_SIGNUP_DOMAINS`     | —                       | Comma-separated email domains allowed when `ORBS_SIGNUP_MODE=domain`. |
| `ORBS_DATA_DIR`           | `<repo>/.data`          | Directory for uploaded project files.                                 |
| `ORBS_UPLOAD_MAX_FILE_MB` | `10`                    | Maximum size of a single uploaded file.                               |
| `ORBS_PROJECT_MAX_MB`     | `500`                   | Maximum total size of one project.                                    |
| `ORBS_PROJECT_MAX_FILES`  | `20000`                 | Maximum number of files in one project.                               |

The bundled `docker-compose.yml` is for **local development only**. Its default database
password can be overridden with `POSTGRES_PASSWORD`; optional profiles start MinIO
(`--profile storage`) and Ollama (`--profile local-ai`).

## Administration

### Sign-up policy

| Mode          | Behavior                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| `open`        | Anyone who can reach the server may register. Suitable for local development.            |
| `invite-only` | Registration requires a valid invitation link whose recipient matches the email address. |
| `domain`      | Only email addresses from the domains listed in `ORBS_SIGNUP_DOMAINS` may register.      |

The first account on a new installation is always permitted, so an administrator can complete the
initial setup.

### Model management

System administrators keep a **registry of AI models** (provider, model ID, prices, maximum data
class) under **System Admin → Models**, with a global on/off switch per model. For each organization they
then choose which models **appear** and which of those are **enabled**: a model that appears but is
disabled is shown greyed out with the reason; a model that does not appear is not offered at all.
A disabled model can't be chosen for a new conversation, even by an outdated client.

### Languages

The interface is available in **English** (default) and **Bahasa Indonesia**. Each person picks
theirs in **Settings → Appearance → Language**; the choice is stored in the browser and also
sent to the server, so error messages and engine descriptions follow it. UI strings live in
`apps/web/src/i18n/messages/*.ts` (English and Indonesian side by side, checked by the compiler),
server messages in `apps/server/src/i18n.ts`. To add a language, add its table next to the
existing two in each of those files.

### Roles and privacy

| Role                                         | Scope            | Can do                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System administrator** (`system.admin`)    | Installation     | Everything except reading conversations: create, rename and delete organizations; create user accounts directly as `org.admin` or `org.member` of an organization; manage members and roles in any organization; reset passwords, change emails, block or delete accounts; set budgets and org-wide skills; delete projects. |
| **Organization administrator** (`org.admin`) | One organization | Invite and manage members, set monthly usage budgets, reset quotas, see usage per member and project.                                                                                                                                                                                                                        |
| **User** (`org.member`)                      | One organization | Create projects and conversations, use their own skills and instructions, see their own usage and budgets.                                                                                                                                                                                                                   |

`system.admin` is stored on the account (`user.role`); `org.admin` and `org.member` are stored per
organization (`member.role`), so one person can administer one organization and be an ordinary user in another.
Accounts without a system role keep the neutral value `user`. The names are defined once in
`packages/protocol/src/roles.ts`.

Privacy rules (strict profile):

- Conversations are private to their creator. **No role**, including system administrators, can read
  conversation titles or content; reports show usage **metadata** only (project, model, token counts).
- System administrators have full control otherwise ("god mode"): they can enter and manage any
  organization without being a member, and may remove even an organization's last administrator. Every one of
  these actions is written to the audit log.
- Only system administrators can create organizations; everyone else joins through an invitation.
- Organization administrators cannot remove or demote the last administrator of their own organization.
- Impersonation is disabled, and the raw account/organization endpoints of the auth library are blocked at
  the HTTP layer: system administrators use Orbs' own audited admin API instead. Deleting an
  account keeps its usage history.
- Resetting someone's password signs them out everywhere. Note that a new password lets the holder
  sign in as that person, so treat this action as sensitive.

Anyone with direct database access can still read the database; role rules protect the application,
not the host.

### Inviting members

Workspace owners and admins can invite people from **Settings → Workspace & members**
(_Pengaturan → Ruang kerja & anggota_ in the current Indonesian interface). Orbs
generates an invitation link that can be shared through any channel (chat, email). Only a person
signed in with the invited email address can accept it.

### System administrators

System administrators manage the entire installation (users, organizations, audit log) through
the administration console. Access can also be granted or revoked from the command line — for
example, to recover access:

```bash
pnpm --filter @orbs/server admin:promote admin@example.com
pnpm --filter @orbs/server admin:demote  admin@example.com
```

## Development

| Command            | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `pnpm dev`         | Run the API server and web app in watch mode.                      |
| `pnpm lint`        | Lint and check formatting with Biome.                              |
| `pnpm format`      | Format the codebase with Biome.                                    |
| `pnpm typecheck`   | Type-check every package.                                          |
| `pnpm test`        | Run unit tests (Vitest).                                           |
| `pnpm build`       | Build the packages that produce artifacts (currently the web app). |
| `pnpm db:up`       | Start the local PostgreSQL container.                              |
| `pnpm db:generate` | Generate a migration from schema changes.                          |
| `pnpm db:migrate`  | Apply pending migrations.                                          |

Continuous integration runs linting, type checks, tests, migrations against a fresh database and a
production build of the web app on pushes to `main` and on every pull request.

## Repository layout

| Path                  | Purpose                                                                | License  |
| --------------------- | ---------------------------------------------------------------------- | -------- |
| `apps/server`         | API server: RPC handlers, authentication, event log, workspace storage | AGPL-3.0 |
| `apps/web`            | Web client: Work and Code modes, settings, administration console      | AGPL-3.0 |
| `apps/runner`         | Agent runner (skeleton; will execute agent turns in isolation)         | AGPL-3.0 |
| `packages/db`         | Database schema and migrations (Drizzle ORM, PostgreSQL)               | AGPL-3.0 |
| `packages/protocol`   | API contract, canonical event schemas and shared validation rules      | MIT      |
| `packages/plugin-sdk` | Plugin manifest schema and helpers                                     | MIT      |

## Security

Security is a core requirement, not an afterthought. Current safeguards include:

- Every data endpoint requires an authenticated session and verifies workspace membership.
- Configurable sign-up policy with invitation links bound to the recipient's email address.
- Blocking a user immediately revokes all of their sessions.
- Security-relevant actions (deletions, role changes, uploads, blocks) are written to an audit log.
- Uploaded paths are normalized and confined to the project directory; secret files such as
  `.env` and private keys are never accepted.

If you discover a vulnerability, please **do not open a public issue**. Report it privately via
[GitHub Security Advisories](https://github.com/anditorx/orbs/security/advisories/new).

## Roadmap

1. **Foundations** — workspaces, conversations, administration, Code-mode projects, application shell _(done)_
2. **Composer & activity timeline** — `@` mentions, `/` commands, attachments, queued messages
3. **Agent & Automatic engine** — first working agent, admin-managed model catalog, cost-aware routing
4. **MCP connectors** — one-click OAuth, encrypted credential vault, audit trail
5. **Skills & plugins** — authoring by chat or form, team registry with admin review
6. **Team security** — SSO (OIDC), data classification, PII redaction, local models
7. **Code mode** — editor, diffs, terminal and coding agents in a sandbox
8. **Desktop app** — Electron client with local folders and auto-update

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull
request. In short: keep changes focused, add tests where practical, sign off your commits
(`git commit -s`), and make sure `pnpm lint && pnpm typecheck && pnpm test` passes.

## License

Orbs is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
The `packages/protocol` and `packages/plugin-sdk` packages are licensed under the
[MIT License](packages/protocol/LICENSE), so clients and plugins can be built without copyleft
obligations.
