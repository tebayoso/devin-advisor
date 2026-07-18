# Test Plan — devin-scope MCP Server Scaffold (PR #1)

**Target:** Local Cloudflare Worker via `wrangler dev --local`, base URL `http://localhost:8787`.
**Transport:** MCP over Streamable HTTP, JSON-RPC 2.0 at `POST /mcp`; health at `GET /health`.
**Method:** Commands executed in a visible terminal (recorded) using curl + jq/python for readable output.

Note on recording: testing is HTTP/curl based. Per user's explicit request to record, commands
are run in a visible GUI terminal so the reviewer can watch the JSON-RPC responses.

## Assertions

### T1 — Health endpoint
- Action: `GET /health`.
- PASS: HTTP status `200` AND body is exactly `ok`.
- FAIL: any other status/body.

### T2 — initialize handshake
- Action: `POST /mcp` `{"method":"initialize"}`.
- PASS: `result.protocolVersion == "2024-11-05"` AND `result.serverInfo.name == "devin-scope"`
  AND `result.serverInfo.version == "0.1.0"`.
- FAIL: missing fields or wrong name.

### T3 — tools/list
- Action: `POST /mcp` `{"method":"tools/list"}`.
- Expected: exactly these tool names present:
  get_scope_instructions, decompose_task, run_adversarial_review, save_plan, get_plan,
  save_memory, query_memory, get_verification_checklist.
- PASS: all 8 names present.
- NOTE/DISCREPANCY: task text says "9 tools" but lists only 8 names; code (tools.ts) defines 8.
  Report actual count = 8 and flag the mismatch. A count of 9 would itself indicate a spec drift.
- FAIL: any listed tool missing, or a name not matching.

### T4 — tools/call get_scope_instructions
- Action: `tools/call` name=get_scope_instructions.
- PASS: `result.content[0].type == "text"` AND parsed text `.instructions` is a non-empty
  markdown string containing the workflow header (e.g. "devin-scope" / "Planning Workflow").
- FAIL: empty/missing instructions.

### T5 — tools/call decompose_task
- Action: `tools/call` name=decompose_task args `{"task":"Implement rate limiting for the public API"}`.
- PASS: parsed text has `subtasks` array (len >= 1) with the task string embedded in `subtasks[0].title`,
  `executionStrategy == "sequential"`, and a `confidenceSummary` string (deterministic skeleton — expected).
- FAIL: no subtasks / wrong shape.

### T6 — tools/call get_verification_checklist
- Action: `tools/call` name=get_verification_checklist.
- PASS: parsed text `.checklist` is a non-empty array of strings.
- FAIL: empty/missing.

### T7 — DB round-trip: save_plan → get_plan
- Action: `save_plan` with a small decomposition object + workspace; capture returned `plan_id`
  (must be a UUID). Then `get_plan` with that id.
- PASS: save returns non-empty `plan_id`; get_plan returns a plan whose `id` == that plan_id,
  `originalTask` matches what was saved, `decomposition` round-trips (subtasks preserved), and
  `createdAt` is an ISO timestamp. This proves a real write+read against local D1.
- FAIL: no plan_id, plan not found, or fields not matching.

### T8 — DB round-trip: save_memory → query_memory
- Action: `save_memory` `{key,value,tags,workspace}`; then `query_memory` with a substring of the value.
- PASS: save returns an `id`; query returns a `results` array containing the saved entry with matching
  key/value, tags array preserved, and same workspace scope.
- FAIL: empty results or mismatched entry.

### T9 (negative/robustness, quick) — error path
- Action: `tools/call` get_plan with a non-existent plan_id.
- PASS: JSON-RPC `error` object returned (code -32000) with message containing "Plan not found".
- This confirms error handling is wired (a broken handler would 500 or return a bogus result).
