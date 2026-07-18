# Hybrid flow: devin-scope planning + official Devin MCP orchestration

This example shows the **hybrid** pattern from PRD §7.1: `devin-scope` produces a high-confidence,
adversarially reviewed plan, then the **official Devin MCP** (`https://mcp.devin.ai/mcp`) executes it
by launching managed Devin sessions for the parallelizable subtasks.

## One-time setup
1. Add the **devin-scope** remote MCP (Settings → Connections → MCP servers → Add a custom MCP → HTTP
   / Streamable HTTP → `https://devin-scope.<your-subdomain>.workers.dev/mcp`).
2. Add the **official Devin MCP** the same way with URL `https://mcp.devin.ai/mcp`.
3. Attach the `devin-scope` Playbook (or connect this repo so the Skill is discovered).

> If the official Devin MCP is **not** connected, the agent simply skips orchestration and hands you
> copy-paste-ready subtask prompts to launch manually. Everything else still works.

## Flow

### 1. Plan with devin-scope
> Scope this task: Implement rate limiting for the public API

The agent runs the mandatory pipeline:
- `decompose_task` → 3–7 subtasks, each with a confidence level
- `save_plan` → `plan_id` (e.g. `plan_abc123`)
- `run_adversarial_review` → weak assumptions, missing edge cases, risks
- revise the decomposition to address findings
- `get_verification_checklist`
- `save_memory` for reusable insights

Suppose the reviewed plan is:

| # | Subtask | Confidence | Depends on |
|---|---------|-----------|------------|
| 1 | Add token-bucket middleware | high | — |
| 2 | Add per-route rate-limit config | high | — |
| 3 | Add Redis-backed counter store | medium | 1 |
| 4 | Add integration tests + docs | high | 1, 2 |

### 2. Launch managed sessions for high-confidence, independent subtasks
Subtasks 1 and 2 are high-confidence with no dependency and touch disjoint files, so run them in
parallel via the official Devin MCP:

```
devin_session_create(
  prompt="[plan_abc123 / subtask 1] Add token-bucket rate-limiting middleware ... <full prompt>",
)
devin_session_create(
  prompt="[plan_abc123 / subtask 2] Add per-route rate-limit configuration ... <full prompt>",
)
```

Subtask 3 is medium-confidence and depends on 1, and subtask 4 depends on 1 and 2 — keep those
**sequential**, launching each only after its prerequisites land.

### 3. Gather results and verify
```
devin_session_gather(...)   # collect PRs, status, findings from the launched sessions
```
Reconcile each returned PR against the verification checklist before marking the subtask done. Launch
the dependent subtasks (3, then 4) once their prerequisites are merged.

### 4. Persist learnings to Knowledge
```
devin_knowledge_manage(...)  # store durable, reusable insight, e.g.
# "Rate-limit middleware must run before auth so unauthenticated floods are cheap to reject."
```
This complements `save_memory` (devin-scope's D1 memory) with Devin-native Knowledge that future
sessions automatically see.

## Division of responsibility
- **devin-scope** — decomposition, confidence scoring, mandatory adversarial review, verification
  checklists, cross-session memory.
- **official Devin MCP** — managed session creation, result gathering, Knowledge management.
