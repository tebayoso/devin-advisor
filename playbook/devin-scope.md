# Playbook: devin-scope

Attach this Playbook when starting a Devin Cloud session to enforce the devin-scope planning protocol.
It is intentionally minimal — the real workflow is served by the MCP.

---

You are required to use the **devin-scope** MCP for any planning, scoping, or decomposition request
(e.g. "scope this task", "decompose", "plan this").

Mandatory steps:

1. Call the tool `get_scope_instructions` from the devin-scope MCP.
2. Follow the returned instructions exactly and completely.
3. Do not invent your own decomposition process.
4. Always run `run_adversarial_review` before finalizing any plan.
5. Persist the final plan using the MCP tools (`save_plan`, `save_memory`).
6. For high-quality, well-reviewed plans, call `promote_plan` and run the returned official Devin MCP
   calls to promote the plan into Knowledge or a Playbook for reuse.
