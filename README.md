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

See [`examples/demo-script.md`](examples/demo-script.md) and
[`examples/ambiguous-tasks.md`](examples/ambiguous-tasks.md).

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
npm test           # runs the unit tests
npm run dev        # local Worker on http://localhost:8787 (POST /mcp)
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

## Roadmap

Work is tracked as GitHub issues in two phases:

- **Foundational** (`phase:foundational`) — scaffolding, core MCP tools, D1 persistence, Skill/Playbook,
  CI, and base docs.
- **Improvements** (`phase:improvements`) — model-backed generation, richer adversarial review, auth,
  Devin API orchestration (Modo B), additional tests, and polish.

## License

[MIT](LICENSE)
