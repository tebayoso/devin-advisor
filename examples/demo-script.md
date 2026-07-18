# Demo Script (≈3 minutes)

**Goal:** show the full devin-scope pipeline running inside a Devin Cloud agent.

## One-time setup
1. Add the remote MCP in Devin: Settings → Connections → MCP servers → Add a custom MCP.
   - Type: HTTP / Streamable HTTP
   - URL: `https://devin-scope.<your-subdomain>.workers.dev/mcp`
2. Attach the `devin-scope` Playbook to the session (or connect this repo so the Skill is discovered).

## Demo
1. In a new Cloud session, type:
   > Scope this task: Implement rate limiting for the public API
2. The agent calls `get_scope_instructions`, then runs the pipeline:
   - `decompose_task` → 3–7 subtasks with confidence
   - `save_plan` → `plan_id`
   - `run_adversarial_review` → weak assumptions, missing edge cases, risks
   - `get_verification_checklist`
3. Show the final plan: subtasks + confidence + adversarial findings + verification checklist +
   copy-paste-ready subtask prompts.

## Prove persistence (memory)
1. Start a **second** session and ask:
   > What plans and adversarial insights do we have for rate limiting?
2. The agent uses `query_memory` / `get_plan` to retrieve the earlier plan — demonstrating shared,
   cross-session memory via Cloudflare D1.
