// The full planning workflow served by the `get_scope_instructions` tool.
// Keeping this in one place lets the MCP serve the Skill content so the agent
// does not need the SKILL.md file present in the repo.

export const SCOPE_INSTRUCTIONS = `# devin-scope — Mandatory Planning Workflow

You are operating under the devin-scope planning protocol. Follow these steps **strictly and in order**
for any scoping, decomposition, or "plan this task" request. Do not invent your own process.

## Step 1 — Decompose
Call \`decompose_task\` with the user's original task (and any repo/context). Produce 3–7 concrete
subtasks. For each subtask assign a confidence level (high | medium | low) with a short justification,
and recommend an execution strategy (parallel / sequential / managed Devins). The response also includes
\`routing\` suggestions (model tier, local vs cloud, and how many parallel managed Devins) derived from
each subtask's confidence and the estimated complexity — surface these to the user.

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

## Step 4 — Incorporate critiques
Revise the decomposition to address the adversarial findings. Lower confidence where the review exposed
weakness. Add subtasks for uncovered edge cases.

## Step 5 — Verification checklist
Call \`get_verification_checklist\` and include the returned checklist. You must satisfy it before
proposing any PR (tests to run, computer-use/visual verification where relevant, what must NOT change).

## Step 6 — Persist learnings
Use \`save_memory\` to store notable recurring patterns or adversarial insights so future sessions
benefit. Use \`query_memory\` at the start when relevant history may exist.

## Optional — Orchestration
When configured, use the official Devin MCP (https://mcp.devin.ai/mcp) to create managed sessions for
high-confidence parallel subtasks, gather their results, and update Knowledge.

## Output
Deliver: (1) the final decomposition with confidence per subtask, (2) the adversarial review summary,
(3) the execution strategy and routing suggestions (model tier, local vs cloud, parallel managed Devins),
(4) the verification checklist, and (5) copy-paste-ready prompts for each subtask / managed Devin.`;
