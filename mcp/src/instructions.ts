// The full planning workflow served by the `get_scope_instructions` tool.
// Keeping this in one place lets the MCP serve the Skill content so the agent
// does not need the SKILL.md file present in the repo.

export const SCOPE_INSTRUCTIONS = `# devin-scope — Mandatory Planning Workflow

You are operating under the devin-scope planning protocol. Follow these steps **strictly and in order**
for any scoping, decomposition, or "plan this task" request. Do not invent your own process.

## Step 1 — Decompose
Call \`decompose_task\` with the user's original task (and any repo/context). Produce 3–7 concrete
subtasks. For each subtask assign a confidence level (high | medium | low) with a short justification,
and recommend an execution strategy (parallel / sequential / managed Devins).

## Step 2 — Persist the plan
Call \`save_plan\` with the decomposition to obtain a \`plan_id\`. All later steps reference this id.

## Step 3 — Adversarial review (MANDATORY)
Call \`run_adversarial_review\` for the saved plan. Actively look for:
- Weak or unstated assumptions
- Missing edge cases and failure modes
- Risks (with severity)
- Concrete recommended changes to the plan
- An overall confidence adjustment
Do NOT skip this step. A plan without an adversarial review is incomplete.
When a Devin API key is configured on the server (Modo B), this runs in a separate, short critic Devin
session; otherwise it falls back to an in-agent review (Modo A). The response's \`mode\` field says which
was used.

## Step 4 — Incorporate critiques
Revise the decomposition to address the adversarial findings. Lower confidence where the review exposed
weakness. Add subtasks for uncovered edge cases.

## Step 5 — Verification checklist
Call \`get_verification_checklist\` and include the returned checklist. You must satisfy it before
proposing any PR (tests to run, computer-use/visual verification where relevant, what must NOT change).

## Step 6 — Persist learnings
Use \`save_memory\` to store notable recurring patterns or adversarial insights so future sessions
benefit. Use \`query_memory\` at the start when relevant history may exist.

## Step 7 — Orchestrate execution (when the official Devin MCP is configured)
When the official Devin MCP (https://mcp.devin.ai/mcp) is connected to the session, orchestrate
execution of the reviewed plan instead of only handing back prompts. devin-scope owns planning +
adversarial rigor; the official Devin MCP owns execution. Use it as follows:

- \`devin_session_create\` — launch one managed Devin session per **high-confidence** subtask that is
  safe to run in parallel (no ordering dependency, disjoint files). Pass the copy-paste-ready prompt
  produced in the Output step, including the \`plan_id\` and subtask id for traceability. Keep
  **medium/low-confidence** or dependent subtasks sequential (run them yourself or launch them one at
  a time after their prerequisites land).
- \`devin_session_gather\` — collect results (PRs, status, findings) from the sessions you launched.
  Reconcile them against the verification checklist before considering a subtask done.
- \`devin_knowledge_manage\` — persist durable, reusable learnings (recurring patterns, adversarial
  insights, gotchas) to Devin Knowledge so future sessions benefit, in addition to \`save_memory\`.

If the official Devin MCP is **not** configured, skip this step and just deliver the copy-paste-ready
prompts so the user can launch sessions manually.

### Example hybrid flow
1. Run Steps 1–6: \`decompose_task\` → \`save_plan\` (\`plan_id\`) → \`run_adversarial_review\` → revise →
   \`get_verification_checklist\` → \`save_memory\`.
2. For each high-confidence, independent subtask, call \`devin_session_create\` with its prompt
   (referencing \`plan_id\` + subtask id). Run dependent/lower-confidence subtasks sequentially.
3. Call \`devin_session_gather\` to collect the resulting PRs/status; verify each against the checklist.
4. Call \`devin_knowledge_manage\` to store any reusable insight for future sessions.

## Step 8 — Promote high-quality plans (optional)
After incorporating the review, call \`promote_plan\` with the \`plan_id\`, the adversarial \`review\`, and
\`review_incorporated: true\`. It scores the plan against quality heuristics (well-scoped, justified,
high-confidence, reviewed + incorporated). If it qualifies, it returns a ready-to-use Knowledge note or
Playbook artifact plus the official Devin MCP calls (\`devin_knowledge_manage\` / \`devin_playbook_manage\`)
to persist it for reuse. Run those calls to promote the plan.

## Output
Deliver: (1) the final decomposition with confidence per subtask, (2) the adversarial review summary,
(3) the execution strategy, (4) the verification checklist, and (5) copy-paste-ready prompts for each
subtask / managed Devin.`;
