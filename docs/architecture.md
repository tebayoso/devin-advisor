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
  - `src/index.ts` — Streamable HTTP transport: HTTP request handling + `/health`.
  - `src/rpc.ts` — transport-agnostic JSON-RPC dispatch (`initialize`, `tools/list`, `tools/call`), shared by the HTTP and stdio transports.
  - `src/tools.ts` — tool definitions and dispatch.
  - `src/db.ts` — Cloudflare D1 persistence.
  - `src/instructions.ts` — content served by `get_scope_instructions`.
  - `src/types.ts` — shared types.
  - `schema.sql` — D1 schema (`plans`, `reviews`, `memory`).
  - `wrangler.toml` — Worker + D1 binding config.
- **Optional local stdio build** (`mcp/src/stdio.ts`) — a secondary transport for
  Devin Desktop / CLI power users. It reuses `src/rpc.ts` + `src/tools.ts` verbatim,
  speaking JSON-RPC over stdin/stdout, and falls back to a local file-backed store
  (`src/local-store.ts`) since remote D1 is unreachable from a local process.
- **Playbook** (`playbook/devin-scope.md`) — primary distribution: forces the agent to call
  `get_scope_instructions` first.
- **Skill** (`.agents/skills/scope/SKILL.md`) — secondary path, auto-discovered for repo-connected orgs.

## Key decisions

- **Streamable HTTP in the critical path** — Cloud agents can only reliably reach remote HTTP MCPs, so
  the primary transport is remote Streamable HTTP. An **optional** local stdio build is offered for
  Desktop/CLI power users but is never required by Cloud sessions.
- **Remote memory (D1)** — so independent Cloud sessions share plan/review history.
- **Adversarial review, Modo A (MVP)** — the tool returns a strong structured prompt and the same Devin
  agent performs the critique. Spawning a separate critic Devin session (Modo B) is deferred.
- **Structured JSON** — tools return clean JSON so the agent can reason over results reliably.

## Scaffold status

`decompose_task` and `run_adversarial_review` currently return deterministic skeletons; model-backed
generation, real persistence wiring, tests, and deployment are tracked in the roadmap issues.
