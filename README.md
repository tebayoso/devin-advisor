# devin-scope

> Turn ambiguous engineering tasks into high-confidence, **adversarially reviewed** execution plans —
> entirely inside Devin Cloud agents.

`devin-scope` is an open-source planning harness for [Devin](https://devin.ai). It gives any Devin
Cloud agent structured **task decomposition**, mandatory **adversarial review**, persistent
**cross-session memory**, and **self-verification** checklists — delivered as a remote MCP server plus a
minimal Playbook and a native Skill.

It targets the #1 historical community pain point: underspecified prompts and agents that dive into
coding before scoping. See [`docs/PRD.md`](docs/PRD.md) and [`docs/REPORT.md`](docs/REPORT.md).

## How it works

```
User ▶ Devin Cloud Agent ▶ get_scope_instructions ▶ MCP tools ▶ Cloudflare D1
        (Playbook / Skill)   (decompose ▶ adversarial review ▶ save ▶ verify)
```

- **Remote MCP server** (Cloudflare Workers + D1, Streamable HTTP) exposing the tools below.
- **Playbook** (`playbook/devin-scope.md`) — primary distribution; forces the agent to call
  `get_scope_instructions` first.
- **Skill** (`.agents/skills/scope/SKILL.md`) — auto-discovered when the repo is connected to your org.

Full design: [`docs/architecture.md`](docs/architecture.md).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `get_scope_instructions` | Serve the full planning workflow the agent must follow |
| `decompose_task` | Break an ambiguous task into 3–7 subtasks with confidence scores |
| `run_adversarial_review` | Structured critique: weak assumptions, missing edge cases, risks |
| `save_plan` / `get_plan` | Persist and retrieve plans |
| `save_memory` / `query_memory` | Cross-session key/value memory scoped by workspace |
| `scope_ticket` | Ingest a Linear/Jira ticket (id or URL) and decompose it into a plan |
| `post_plan_to_ticket` | Post a saved plan back to its Linear/Jira ticket as a comment |
| `get_verification_checklist` | Self-verification checklist to satisfy before proposing a PR |
| `promote_plan` | Score a plan against quality heuristics and, if it qualifies, emit a Knowledge/Playbook artifact + the Devin MCP calls to persist it |

### Promoting high-quality plans

Once a plan has been decomposed, adversarially reviewed, and incorporated, call `promote_plan` to
auto-promote it into **Devin Knowledge** or a new **Playbook** for reuse. See
[`docs/promotion.md`](docs/promotion.md) for the heuristics and the full flow.

### Linear / Jira integration

`scope_ticket` and `post_plan_to_ticket` read ticket content from Linear or Jira
and can write the final plan back as a comment. Configure credentials as Worker
secrets (never commit them): `LINEAR_API_KEY` for Linear, and
`JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` for Jira. The provider is
inferred from a ticket URL, or pass `provider: "linear" | "jira"` with a bare id.

> **Scaffold status:** `decompose_task` and `run_adversarial_review` currently return deterministic,
> structured skeletons so the end-to-end pipeline and D1 persistence work reliably. Model-backed
> generation is tracked under `phase:improvements`. See [`docs/architecture.md`](docs/architecture.md).

## Quick start (4 steps)

1. **Deploy the MCP** (once):
   ```bash
   cd mcp
   npm install
   wrangler d1 create devin_scope          # paste the database_id into wrangler.toml
   npm run db:init                          # applies schema.sql
   npm run deploy                           # deploys to Cloudflare Workers
   ```
2. **Add the MCP in Devin**: Settings → Connections → MCP servers → Add a custom MCP →
   HTTP / Streamable HTTP → `https://devin-scope.<your-subdomain>.workers.dev/mcp`.
3. **Attach the Playbook** `devin-scope` when starting a session (or connect this repo so the Skill is
   discovered).
4. **Use it**: `Scope this task: <your ambiguous task>`.

Verify the deployment at any time:
```bash
curl https://devin-scope.<your-subdomain>.workers.dev/health      # -> ok
```

See [`examples/demo-script.md`](examples/demo-script.md),
[`examples/ambiguous-tasks.md`](examples/ambiguous-tasks.md), and
[`examples/managed-orchestration.md`](examples/managed-orchestration.md) (hybrid flow with the
official Devin MCP).

### Optional: adversarial critic session (Modo B)

By default `run_adversarial_review` performs the review in-agent (Modo A). If you configure a Devin API
key, the review is instead delegated to a short, separate critic Devin session via the Devin REST API,
and the tool gracefully falls back to Modo A when the session is unavailable or fails:

```bash
cd mcp
wrangler secret put DEVIN_API_KEY   # never commit this value
```

The review response includes a `mode` field (`in-agent` or `critic-session`) and, for Modo B, the
`criticSessionUrl`.

## Local development

```bash
cd mcp
npm install
npm run typecheck
npm test              # unit tests (node:test via tsx)
npm run test:integration  # workers-runtime integration tests (vitest)
npm run dev        # local Worker on http://localhost:8787 (POST /mcp)
```

Only `POST /mcp` (JSON-RPC 2.0) and `GET /health` are served. Quick smoke test:
```bash
curl -s http://localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Authentication (optional)

The MCP is **public by default** (per PRD §6.1/§13) so the demo works with no setup. For
non-demo deployments you can require a shared Bearer token:

1. Set the `AUTH_TOKEN` secret on the Worker:
   ```bash
   cd mcp
   wrangler secret put AUTH_TOKEN     # paste your token when prompted
   ```
   For local dev, put it in a git-ignored `mcp/.dev.vars` file: `AUTH_TOKEN = "your-token"`.
2. When `AUTH_TOKEN` is set, every `POST /mcp` request must include the header
   `Authorization: Bearer <AUTH_TOKEN>`; requests that are missing it or send the wrong token
   get `401 Unauthorized`. In Devin, add the header under the custom MCP server's configuration.
3. When `AUTH_TOKEN` is unset, behavior is unchanged (public demo). `GET /health` is always public.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — full product spec.
- [`docs/architecture.md`](docs/architecture.md) — design and key decisions.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — troubleshooting & FAQ.
- [`docs/marketplace.md`](docs/marketplace.md) — Devin MCP Marketplace submission prep.
- [`examples/`](examples) — demo script and example ambiguous tasks.

## Troubleshooting & FAQ

Common fixes (full list in [`docs/troubleshooting.md`](docs/troubleshooting.md)):

- **Tools not listed in Devin?** Ensure the URL ends in `/mcp` and the transport is HTTP / Streamable
  HTTP; check `GET /health` returns `ok`.
- **`no such table` errors?** Apply the schema with `npm run db:init`.
- **`wrangler deploy` D1 error?** Create the database and paste its `database_id` into `wrangler.toml`.
- **Memory empty in a second session?** Use a consistent `workspace` id (or omit it in both places).

## Devin MCP Marketplace

An official Marketplace listing is a post-MVP goal. Submission metadata, prerequisites, and a
readiness checklist are prepared in [`docs/marketplace.md`](docs/marketplace.md).

## Local stdio transport (Devin Desktop / CLI) — optional

The primary, Cloud-first path is the remote **Streamable HTTP** Worker above. As a
convenience for Devin **Desktop / CLI** power users, `devin-scope` also ships an
**optional local stdio build** (`mcp/src/stdio.ts`) that exposes the *exact same
tools* over newline-delimited JSON-RPC 2.0 on stdin/stdout.

```bash
cd mcp
npm install                # installs tsx (used to run the TypeScript entrypoint)

# Register the local server with the Devin CLI (adjust the absolute path):
devin mcp add devin-scope-local -- npm --prefix /ABSOLUTE/PATH/TO/devin-advisor/mcp run stdio
# Equivalent direct form:
# devin mcp add devin-scope-local -- npx -y tsx /ABSOLUTE/PATH/TO/devin-advisor/mcp/src/stdio.ts
```

Then use it exactly like the remote server (e.g. `Scope this task: <your task>`).

**Persistence — D1 is remote.** Cloudflare D1 backs the HTTP Worker and is *not*
reachable from a local process, so the stdio build falls back to a **local
file-backed store** (`mcp/src/local-store.ts`).

- Default location: `~/.devin-scope/local-store.json`.
- Override with `DEVIN_SCOPE_LOCAL_DB=/path/to/store.json`.
- Use `DEVIN_SCOPE_LOCAL_DB=:memory:` for an ephemeral, non-persisted store.

Limitation: unlike remote D1, this local store is **per-machine and not shared**
across sessions or other users. For shared cross-session memory, use the remote
Streamable HTTP deployment.

## Roadmap

Work is tracked as GitHub issues in two phases:

- **Foundational** (`phase:foundational`) — scaffolding, core MCP tools, D1 persistence, Skill/Playbook,
  CI, and base docs.
- **Improvements** (`phase:improvements`) — model-backed generation, richer adversarial review, auth,
  Devin API orchestration (Modo B), additional tests, and polish.

## License

[MIT](LICENSE)
