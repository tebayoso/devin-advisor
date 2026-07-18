---
name: scope
description: >-
  Turn an ambiguous engineering task into a high-confidence, adversarially
  reviewed execution plan using the devin-scope MCP. Use for any "scope",
  "decompose", or "plan this task" request.
---

# scope

When the user asks you to scope, decompose, or plan a task, follow the **devin-scope**
protocol below strictly and in order. Do not invent your own decomposition process.

> If the `devin-scope` MCP is configured, call its `get_scope_instructions` tool first and
> follow the returned instructions verbatim — they are the source of truth. This file mirrors
> them for repo-connected discovery.

## Workflow

1. **Decompose** — Call `decompose_task` with the original task (plus repo/context). Produce
   3–7 concrete subtasks, each with a confidence level (high | medium | low) and short
   justification, and a recommended execution strategy (parallel / sequential / managed Devins).
2. **Persist** — Call `save_plan` to store the decomposition and get a `plan_id`.
3. **Adversarial review (MANDATORY)** — Call `run_adversarial_review` for the plan. Surface weak
   assumptions, missing edge cases, risks (with severity), recommended changes, and an overall
   confidence adjustment. Never skip this.
4. **Incorporate** — Revise the decomposition to address the findings; lower confidence where the
   review exposed weakness; add subtasks for uncovered edge cases.
5. **Verification checklist** — Call `get_verification_checklist` and include it. Satisfy it before
   proposing any PR.
6. **Persist learnings** — Use `save_memory` for reusable insights; `query_memory` at the start when
   relevant history may exist.

## Optional orchestration

When configured, use the official Devin MCP (`https://mcp.devin.ai/mcp`) to launch managed sessions
for high-confidence parallel subtasks, gather results, and update Knowledge.

## Output

Deliver: the final decomposition with per-subtask confidence, the adversarial review summary, the
execution strategy, the verification checklist, and copy-paste-ready prompts for each subtask.
