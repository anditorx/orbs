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
- **MCP connectors, next steps** — letting the agent use a connection, approvals before anything is written, dashboards from connected data. Sign-in, the encrypted vault and an Asana connection (read-only) already exist; see [Connections](#connections-mcp).
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

| Variable                      | Default                 | Description                                                                                                      |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | —                       | PostgreSQL connection string. **Required.**                                                                      |
| `BETTER_AUTH_SECRET`          | —                       | Secret used to sign sessions (at least 32 characters). **Required.**                                             |
| `BETTER_AUTH_URL`             | `http://localhost:8787` | Base URL of the API as seen by the browser.                                                                      |
| `ORBS_WEB_URL`                | `http://localhost:5173` | Origin of the web app (used for CORS and auth redirects).                                                        |
| `ORBS_SERVER_PORT`            | `8787`                  | Port the API server listens on.                                                                                  |
| `ORBS_SIGNUP_MODE`            | `open`                  | Who may create an account: `open`, `invite-only` or `domain`.                                                    |
| `ORBS_SIGNUP_DOMAINS`         | —                       | Comma-separated email domains allowed when `ORBS_SIGNUP_MODE=domain`.                                            |
| `ORBS_DATA_DIR`               | `<repo>/.data`          | Directory for uploaded project files.                                                                            |
| `ORBS_UPLOAD_MAX_FILE_MB`     | `10`                    | Maximum size of a single uploaded file.                                                                          |
| `ORBS_PROJECT_MAX_MB`         | `500`                   | Maximum total size of one project.                                                                               |
| `ORBS_PROJECT_MAX_FILES`      | `20000`                 | Maximum number of files in one project.                                                                          |
| `ORBS_CONNECTOR_RATE_PER_MIN` | `60`                    | Calls per minute one person may make through one connection.                                                     |
| `ORBS_ALLOW_PRIVATE_MCP_URLS` | `false`                 | Allow custom MCP servers on private addresses and plain http (trusted self-hosted setups only).                  |
| `ORBS_SECRET_KEY`             | —                       | 32-byte base64 key that encrypts connector credentials (`openssl rand -base64 32`). Required to use connections. |

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

System administrators manage models under **System Admin → Models**:

1. **Add model provider** opens a prompt (details below). Once the provider shows **Connected**, open it to
   see every model its key offers.
2. Each model has two switches. **Active** puts the model in the model lists (it is registered the first time,
   under the provider's own name for it). **Enabled** decides whether people can choose it: a model that is
   active but not enabled is still listed, shown greyed out with the reason, and the server refuses it for a
   new conversation even from an outdated client.
3. Every active model appears in every organization. **Models per organization** lets an administrator hide a
   model from one organization, or switch it off there (greyed out), overriding the default for that
   organization only. Prices and the maximum data class are edited under **Active models**.

Making a model inactive removes it from all lists but keeps its prices and settings.

Usage is shown in tokens, US dollars and rupiah. Everyone sees their own under **Usage**: totals, per project,
per provider, per model and per day. Organization administrators also see each member (with a daily chart and
per-provider rollup), and system administrators see this month's cost per provider and per model across all
organizations under **System Admin → Models**. A model with no price set is recorded at zero cost, so set prices
under **Active models**. Nothing is recorded until the agent exists to call the models.

What happens to models when their provider changes:

- **Provider not connected** (key revoked or expired, or credentials never set up): its models stay, with all their
  settings, and are shown **dimmed** with the reason "Its provider isn't connected right now". They can't be chosen,
  and "Automatic" ignores them. When the provider connects again they come back by themselves. A passing problem
  (network, timeout, provider overload) does not count: it takes three failed background checks in a row, while a
  key the provider rejects counts at once.
- **Provider deleted**: its models are deleted with it, including their prices and per-organization settings. The
  confirmation says how many. Conversation and usage history are kept (usage is recorded by name with the price
  frozen at the time).

### Model providers

Model management is for **system administrators only**: every model and provider call is refused for
anyone else, and `/admin` redirects other roles away. Under **System Admin → Models**, **Add model provider**
opens a short conversation. A suggestion is ready to send as it is
(`/add-new-model-provider Help me add a new model provider. Start by asking for its name and connection details.`),
and the assistant then asks only for what is still missing: which provider (Gemini first), the API key, and
optional labels (a name, project name, project number). You can answer in one go instead, with labelled lines
or the `curl` example from Google AI Studio. The key is hidden in the transcript, goes straight to the server
and is stored encrypted with `ORBS_SECRET_KEY` (only its last four characters are ever shown again). This is a
scripted assistant, not a language model: it recognises the details it needs and asks for the rest.

Connecting checks the key with the provider. The **Connected / Connection failed** badge is live: Orbs
re-verifies the key on every load, every 30 seconds and whenever you return to the window, so a revoked or
expired key shows as failed without anyone clicking anything.

Opening a connected provider also runs **Check endpoints and models**, which lists every model the key can
see and probes each endpoint family once with the smallest possible request (a few tokens): list models,
get a model, generate, stream, count tokens, embeddings, files, cached contents and tuned models. A model
that is listed but refused for your project (or temporarily overloaded) is skipped for the next candidate.
Tuned models are reported as "not offered to API keys" rather than failed, because Google only serves them
to OAuth credentials.

To try the screens without a key: `MOCK_GEMINI_KEY=demo-key pnpm --filter @orbs/server dev:mock-gemini`
and set `ORBS_GEMINI_API_URL=http://127.0.0.1:8798/v1beta` (never in production; it also redirects the
live status checks).

### Chat with a model

Conversations now get replies. A message queues a **turn** (a database row, so a restart can't leave a
conversation "typing" forever); a worker inside the API process takes it, asks the model, streams the text to
the screen as it is written and stores only the **final answer** as an event. **Stop** keeps what was written
so far, marked unfinished. Tokens spent are recorded in the usage ledger (dollars and rupiah) for finished,
failed and stopped replies alike, and the monthly budgets apply before a message is accepted.

A model can answer only when **all** of these hold: its provider is connected, an administrator has confirmed
the provider account is on a **paid plan** (the switch on the provider's row), its **price** is filled in
(at or above the provider's price, so use is never counted as free), it is Active and Enabled, and the
organization hasn't switched it off. The paid-plan confirmation exists because free plans may let the
provider use prompts and replies to improve its products; Orbs can't tell the plan from the key, so an
administrator has to say it. _Automatic_ picks the cheapest usable priced model.

Saved instructions are part of every reply: the base prompt, then the organization's, the project's and the
person's own, and the conversation so far (about the last 30,000 tokens). One reply is written at a time per
conversation, a person can send 20 messages a minute, a transient failure before any text is retried twice
(1 s, 3 s), and a reply gives up after 30 s of silence or 120 s in total. A conversation still called "New conversation" is named after its topic by the model after the first reply, and
rechecked every fourth reply (the naming call is billed like any other); a title you typed yourself is never
changed. Replies are rendered as Markdown (headings, lists, tables, code; raw HTML is shown as text, unsafe links are
dropped and images are not loaded). No tools or other providers yet.

Integration tests (they create and remove their own rows) must run against a scratch database, never your real one:
`DATABASE_URL=postgres://…/orbs_scratch pnpm --filter @orbs/server test:integration`. The mock Gemini also
answers chat: it echoes your last message, and `#429`, `#503`, `#flaky`, `#slow`, `#blocked` and `#empty` in the
message make it fail in the matching way.

**Connected apps in chat.** The apps a person connected (Asana, by token or sign-in) are offered to the model as
tools in every reply, so "list my Asana tasks" is answered from their real data. Only read-only actions are offered,
nothing is ever created, changed or deleted, and a reply makes at most six rounds of tool use before the model must
answer with what it has. Results are handed over as data with a note to ignore any instructions inside them, are cut at
20,000 characters, and every call is rate-limited and audited like a manual one. The chat shows which app was used, each
round's tokens are billed, and an app whose connection expired is left out with a note asking to reconnect. Not offered
yet: your own MCP servers, actions that write, and models without tool calling (Gemma).

**Which workspaces.** An Asana account can have several workspaces. A token connection covers all of them: asking for
"my tasks" looks in each and labels every answer with its workspace, and naming one ("in Acme") narrows it. When the
account has more than one, the Asana row shows a checklist of the workspaces the assistant may use; only the ticked ones
are searched, listed by `get_me`, or reachable by a task's id. Before anything is chosen all are on, and pasting a new
token starts over. A sign-in (MCP) connection belongs to the single workspace picked when it was authorized, because
Asana's MCP tokens are workspace-scoped, so it has nothing to choose.

### Connections (MCP)

People can connect their own accounts in other apps under **Customize → Connections (MCP)**. The
first service is **Asana**, through its MCP server. A connection is read-only for now: Orbs keeps its
own allow-list of tools and blocks every tool that changes or deletes data, plus any tool it has not
reviewed yet (Asana's sign-in has no scopes, so Orbs is the only gatekeeper).

Connections belong to each person. Anyone can connect their own account with **their own OAuth
app** (see below), so no setup is needed. A system administrator may optionally register a **shared
app** once per installation:

1. Set `ORBS_SECRET_KEY` (see [Configuration](#configuration)) and restart the server. Back it up:
   without it stored connections become unreadable.
2. In Asana's developer console create an **MCP app** and register the redirect URI shown under
   **System Admin → Connections** (`<ORBS_WEB_URL>/api/connections/oauth/callback`).
3. Paste the app's client ID and secret into **System Admin → Connections**. The secret is
   encrypted on the server and never shown again.

With a shared app configured, everyone can connect right away.

There are two ways to connect, as tabs in the Asana row. **Token** is the simplest: paste one personal
access token (Asana → My settings → Apps → Personal access token; the eye icon shows what you pasted). Orbs
tries it against Asana first, stores it encrypted, and asks for a new one when Asana stops accepting it; no
OAuth app is needed. Asana's MCP server only accepts tokens issued by its own sign-in ("token was not issued
by Asana OAuth"), so a token connection reads through Asana's **REST API** instead, with a small set of
read-only actions Orbs defines itself (`get_me`, `get_my_tasks`, `list_projects`, `get_task`, `search_tasks`;
search needs a paid Asana plan). Every request is a GET. **MCP (sign in)** uses the OAuth flow below. If Asana answers `redirect_uri parameter does not match`,
the address registered in your Asana app (OAuth tab) is not exactly the one Orbs shows.
**Connect** sends you to Asana and Asana brings you back to Orbs. For that, add exactly the address Orbs shows
(`<ORBS_WEB_URL>/api/connections/oauth/callback`) under Redirect URLs in the Asana app; with an empty list Asana answers
`redirect_uri parameter does not match`. Asana documents https for web apps, and its forum has reports both ways about
`http://localhost`. If it refuses your address, reach Orbs through an HTTPS tunnel (`ORBS_WEB_URL` and `BETTER_AUTH_URL`
set to the tunnel's address, `ORBS_ALLOWED_HOSTS` to its domain, Orbs opened through that address), or use **Use a code
instead**: tick **This is a native or command-line app** in the Asana app, and copy the code Asana shows once; coming back
to Orbs picks it up from the clipboard, or paste it in the field.

Each person then clicks **Connect** and signs in with their own Asana account, so Orbs never sees
more than that person can. Tokens are stored encrypted per organization and person, refreshed
automatically, and revoked at Asana when someone disconnects. Connecting, disconnecting and every
tool call (the tool name only, never content) appear in the audit log.

Anyone, in any role, can register **their own OAuth app** under **Use my own app**, without waiting for
a system administrator. It applies only to that person's account and replaces the shared app; saving
or removing it disconnects their current connection.

### Your own MCP servers

Under **Add an MCP server** anyone can connect any MCP server by its address (and an optional bearer
token). It belongs to that person alone. Because the server is untrusted, Orbs:

- accepts only public **https** addresses and checks DNS on every connection, so it can't be pointed at
  internal services (cloud metadata, databases, localhost). Trusted self-hosted setups can relax this
  with `ORBS_ALLOW_PRIVATE_MCP_URLS=true`;
- refuses redirects, so a token never leaves for an unchecked address;
- runs **nothing** until the owner switches a specific tool on (labels like "says it only reads" come
  from the server and never grant access);
- encrypts the token, caps output, rate-limits calls (`ORBS_CONNECTOR_RATE_PER_MIN`), allows 10 servers
  per person, and audits adds, removals and calls (names and hosts only).

Servers that need OAuth sign-in are not supported yet; only none or a bearer token.

For services Orbs has no built-in support for, **Add by prompt** on the same page opens a prompt box, pre-filled
in the active language (`/Add-MCP Help me add a new global MCP server…`). Sending it starts a
conversation about the new connection. Until the agent exists the message is only stored, and the
box warns people not to paste secrets.

People can also try an allowed action by hand: under **Show actions**, pick one and run it with JSON
arguments to see the raw answer. Calls are limited per connection (see `ORBS_CONNECTOR_RATE_PER_MIN`)
and long answers are cut at 100,000 characters.

To try the flow without an Asana account, run `pnpm --filter @orbs/server dev:mock-asana`, set
`ORBS_ASANA_MCP_URL=http://127.0.0.1:8799/v2/mcp`, and use client ID `mock-client` / secret
`mock-secret`. Never set `ORBS_ASANA_MCP_URL` in production.

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

| Command                                       | Description                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                                    | Run the API server and web app in watch mode.                                                                                                                                                                                  |
| `pnpm lint`                                   | Lint and check formatting with Biome.                                                                                                                                                                                          |
| `pnpm format`                                 | Format the codebase with Biome.                                                                                                                                                                                                |
| `pnpm typecheck`                              | Type-check every package.                                                                                                                                                                                                      |
| `pnpm test`                                   | Run unit tests (Vitest).                                                                                                                                                                                                       |
| `pnpm --filter @orbs/server test:integration` | Run the connector, provider and model flows against the database in `DATABASE_URL` (also needs `ORBS_SECRET_KEY`). Prefer a scratch database: `createdb orbs_scratch`, migrate it, and run with `DATABASE_URL=…/orbs_scratch`. |
| `pnpm build`                                  | Build the packages that produce artifacts (currently the web app).                                                                                                                                                             |
| `pnpm db:up`                                  | Start the local PostgreSQL container.                                                                                                                                                                                          |
| `pnpm db:generate`                            | Generate a migration from schema changes.                                                                                                                                                                                      |
| `pnpm db:migrate`                             | Apply pending migrations.                                                                                                                                                                                                      |

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
- Connector credentials and tokens are encrypted at rest (AES-256-GCM, bound to their owner), never
  returned by the API, and sign-in uses PKCE, a single-use `state` and issuer checking.
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
