import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalD1 } from "./local-store.js";
import { handleRpc } from "./rpc.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import type { Env } from "./types.js";

function makeEnv(): Env {
  // Ephemeral, non-persisted local store (mirrors DEVIN_SCOPE_LOCAL_DB=":memory:").
  return { DB: createLocalD1(null) };
}

function parseToolResult(response: unknown): unknown {
  const result = (response as { result?: { content?: { text: string }[] } }).result;
  assert.ok(result?.content?.[0]?.text, "expected tool text content");
  return JSON.parse(result.content[0].text);
}

test("tools/list exposes the same tools as the HTTP transport", async () => {
  const res = await handleRpc(makeEnv(), { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const tools = (res.result as { tools: { name: string }[] }).tools;
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    TOOL_DEFINITIONS.map((t) => t.name).sort(),
  );
});

test("initialize returns server info", async () => {
  const res = await handleRpc(makeEnv(), { jsonrpc: "2.0", id: 1, method: "initialize" });
  const info = (res.result as { serverInfo: { name: string } }).serverInfo;
  assert.equal(info.name, "devin-scope");
});

test("save_plan / get_plan roundtrip through the local store", async () => {
  const env = makeEnv();
  const decomposition = {
    subtasks: [],
    executionStrategy: "sequential",
    estimatedComplexity: "low",
    confidenceSummary: "ok",
  };
  const saved = parseToolResult(
    await handleRpc(env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "save_plan",
        arguments: { original_task: "build widget", decomposition },
      },
    }),
  ) as { plan_id: string };
  assert.ok(saved.plan_id);

  const fetched = parseToolResult(
    await handleRpc(env, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_plan", arguments: { plan_id: saved.plan_id } },
    }),
  ) as { id: string; originalTask: string };
  assert.equal(fetched.id, saved.plan_id);
  assert.equal(fetched.originalTask, "build widget");
});

test("save_memory / query_memory roundtrip through the local store", async () => {
  const env = makeEnv();
  await handleRpc(env, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "save_memory",
      arguments: { key: "deploy", value: "use wrangler deploy", tags: ["ops"] },
    },
  });
  const queried = parseToolResult(
    await handleRpc(env, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "query_memory", arguments: { query: "wrangler" } },
    }),
  ) as { results: { key: string }[] };
  assert.equal(queried.results.length, 1);
  assert.equal(queried.results[0].key, "deploy");
});
