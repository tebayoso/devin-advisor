# Architecture

`devin-scope` is a Cloud-first planning harness for Devin. It is delivered as a remote MCP server plus
a minimal Playbook and a native Skill.

```
User ──▶ Devin Cloud Agent
              │  (Playbook or Skill triggers the protocol)
              ▼
        get_scope_instructions
              │
              ▼
   Remote MCP Server (Cloudflare Workers, Streamable HTTP)
     tools: decompose_task, run_adversarial_review,
            save_plan/get_plan, save_memory/query_memory,
            get_verification_checklist
              │
              ▼
        Cloudflare D1 (plans, reviews, memory)
```

## Components

- **MCP server** (`mcp/`) — a Cloudflare Worker exposing MCP over Streamable HTTP at `POST /mcp`.
  - `src/index.ts` — JSON-RPC request handling (`initialize`, `tools/list`, `tools/call`) + `/health`.
  - `src/tools.ts` — tool definitions and dispatch.
  - `src/db.ts` — Cloudflare D1 persistence.
  - `src/instructions.ts` — content served by `get_scope_instructions`.
  - `src/types.ts` — shared types.
  - `schema.sql` — D1 schema (`plans`, `reviews`, `memory`).
  - `wrangler.toml` — Worker + D1 binding config.
- **Playbook** (`playbook/devin-scope.md`) — primary distribution: forces the agent to call
  `get_scope_instructions` first.
- **Skill** (`.agents/skills/scope/SKILL.md`) — secondary path, auto-discovered for repo-connected orgs.

## Key decisions

- **Streamable HTTP only** — Cloud agents can only reliably reach remote HTTP MCPs. No local stdio in
  the critical path.
- **Remote memory (D1)** — so independent Cloud sessions share plan/review history.
- **Adversarial review, Modo A (MVP)** — the tool returns a strong structured prompt and the same Devin
  agent performs the critique. Spawning a separate critic Devin session (Modo B) is deferred.
- **Structured JSON** — tools return clean JSON so the agent can reason over results reliably.
- **Workspace isolation** — every tenant-scoped table (`plans`, `reviews`, `memory`) carries a NOT NULL
  `workspace` column and each tool normalizes a missing workspace to a canonical `default` bucket. All
  reads (`get_plan`, `query_memory`, `run_adversarial_review`) filter by workspace, so data is isolated
  per workspace and cross-workspace reads are prevented. Backfill: `migrations/0001_workspace_isolation.sql`.

## Data model

D1 tables (`schema.sql`):

- `plans` — `id`, `workspace`, `original_task`, `decomposition` (JSON), `confidence_summary`,
  `created_at`. Written by `save_plan`, read by `get_plan`.
- `reviews` — adversarial review records associated with a plan.
- `memory` — `id`, `workspace`, `key`, `value`, `tags`, `created_at`. Written by `save_memory`;
  `query_memory` does a substring (`LIKE`) match over key/value/tags, scoped by `workspace`.

## Scaffold status

`decompose_task` and `run_adversarial_review` currently return deterministic skeletons; model-backed
generation, real persistence wiring, tests, and deployment are tracked in the roadmap issues.

## Related docs

- [`PRD.md`](PRD.md) — full product spec.
- [`troubleshooting.md`](troubleshooting.md) — troubleshooting & FAQ.
- [`marketplace.md`](marketplace.md) — Devin MCP Marketplace submission prep.
