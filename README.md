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
| `get_verification_checklist` | Self-verification checklist to satisfy before proposing a PR |

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

See [`examples/demo-script.md`](examples/demo-script.md) and
[`examples/ambiguous-tasks.md`](examples/ambiguous-tasks.md).

## Local development

```bash
cd mcp
npm install
npm run typecheck
npm run dev        # local Worker on http://localhost:8787 (POST /mcp)
```

Only `POST /mcp` (JSON-RPC 2.0) and `GET /health` are served. Quick smoke test:
```bash
curl -s http://localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

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

## Roadmap

Work is tracked as GitHub issues in two phases:

- **Foundational** (`phase:foundational`) — scaffolding, core MCP tools, D1 persistence, Skill/Playbook,
  CI, and base docs.
- **Improvements** (`phase:improvements`) — model-backed generation, richer adversarial review, auth,
  Devin API orchestration (Modo B), additional tests, and polish.

## License

[MIT](LICENSE)
