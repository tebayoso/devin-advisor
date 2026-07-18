import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createLocalD1 } from "../src/local-store.js";
import { handleRpc } from "../src/rpc.js";
import { TOOL_DEFINITIONS } from "../src/tools.js";
import type { Env } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

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

test("stdio server survives malformed input and keeps serving", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", join(HERE, "..", "src", "stdio.ts")], {
    env: { ...process.env, DEVIN_SCOPE_LOCAL_DB: ":memory:" },
    stdio: ["pipe", "pipe", "inherit"],
  });

  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
  });

  // Malformed lines (valid JSON but not a request, then a syntax error) must NOT
  // crash the long-lived server; a following valid request must still be answered.
  child.stdin.write("null\n");
  child.stdin.write("123\n");
  child.stdin.write('{"foo":"bar"}\n');
  child.stdin.write("{ not json\n");
  child.stdin.write('{"jsonrpc":"2.0","id":9,"method":"initialize"}\n');
  child.stdin.end();

  const code: number | null = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, "server should exit cleanly on stdin end, not crash");

  const responses = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: unknown; result?: { serverInfo?: { name: string } } });
  const initialize = responses.find((r) => r.id === 9);
  assert.ok(initialize, "valid request after malformed input should be answered");
  assert.equal(initialize?.result?.serverInfo?.name, "devin-scope");
});
