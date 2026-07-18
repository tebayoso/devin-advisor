# Auto-promoting high-quality plans (PRD §12)

`devin-scope` can promote a high-confidence, well-reviewed plan into **Devin Knowledge** or a new
**Playbook** so future sessions reuse a proven decomposition instead of starting from scratch.

Promotion is exposed through the `promote_plan` MCP tool. The tool itself never calls the official Devin
MCP — it evaluates the plan, and (when it qualifies) returns ready-to-use artifacts plus the exact
official-Devin-MCP calls the agent should run. This keeps the Worker stateless and secret-free while the
agent (which already has the official Devin MCP configured) performs the actual write.

## What counts as "high-quality"

`promote_plan` scores a plan out of 100 using the heuristics below. A plan is **promotable only when it
clears the score threshold (default 80) _and_ every mandatory gate passes.**

| Check | Weight | Mandatory | Passes when |
| --- | --- | --- | --- |
| `well_scoped` | 15 | no | The plan has 3–7 subtasks |
| `justified` | 15 | no | Every subtask has a substantive justification |
| `high_confidence` | 25 | no | Average confidence ≥ 0.70 and no `low`-confidence subtasks |
| `confidence_summary` | 10 | no | A meaningful confidence summary exists (not the skeleton default) |
| `review_present` | 15 | **yes** | An adversarial review with findings was supplied |
| `review_incorporated` | 15 | **yes** | `review_incorporated: true` — the findings were applied |
| `risks_addressed` | 5 | no | No high-severity (≥4) risks remain unless the review was incorporated |

The two mandatory gates enforce the "well-reviewed" requirement: a plan can never be promoted without an
adversarial review that was actually incorporated, regardless of its score.

## Flow

1. Run the full devin-scope pipeline: `decompose_task` → `save_plan` → `run_adversarial_review` →
   incorporate the findings.
2. Call `promote_plan`:
   ```json
   {
     "plan_id": "<from save_plan>",
     "review": { /* the AdversarialReview from run_adversarial_review */ },
     "review_incorporated": true,
     "target": "knowledge"        // or "playbook"; defaults to "knowledge"
   }
   ```
3. Inspect the returned `assessment` (score, per-check breakdown, `reasons`/`failures`).
4. If `assessment.eligible` is `true`, the response includes:
   - a `knowledge` or `playbook` artifact (name, tags/slug, body/content), and
   - `suggestedMcpCalls` — the official Devin MCP calls to persist it
     (`devin_knowledge_manage` / `devin_playbook_manage` on `https://mcp.devin.ai/mcp`).
5. Run the suggested calls via the official Devin MCP to create the Knowledge note or Playbook.
6. Reuse the promoted Knowledge/Playbook on future similar tasks.

If the plan is **not** eligible, `promote_plan` returns the assessment with concrete `failures` and no
artifacts — fix the plan (add justifications, raise confidence, incorporate the review) and try again.

## Notes

- The `target` selects Knowledge (default) or a Playbook. Override the `threshold` per call if needed.
- Artifact generation is deterministic and unit-tested (`mcp/test/promotion.test.ts`).
- No secrets are handled here; the agent's existing official-Devin-MCP connection performs the write.
