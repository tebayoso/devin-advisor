import assert from "node:assert/strict";
import { after, test } from "node:test";
import worker from "../src/index.js";
import { LATENCY_BUDGET_MS, log, redact } from "../src/logger.js";
import type { Env } from "../src/types.js";

// --- Minimal in-memory D1 stub (only what the tools exercise) ----------------
function makeEnv(): Env {
  const plans = new Map<string, Record<string, unknown>>();
  const db = {
    prepare(sql: string) {
      const stmt = {
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          this._args = args;
          return this;
        },
        async run() {
          if (sql.includes("INSERT INTO plans")) {
            const [id] = this._args as string[];
            plans.set(id, { id });
          }
          return { success: true };
        },
        async first<T>() {
          return null as T | null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  };
  return { DB: db } as unknown as Env;
}

function rpc(method: string, params?: Record<string, unknown>, id = 1) {
  return new Request("https://scope.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-session-id": "sess-abc" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

// Capture structured log lines emitted during a callback.
async function captureLogs(fn: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const grab = (l: string) => {
    try {
      lines.push(JSON.parse(l));
    } catch {
      /* ignore non-JSON */
    }
  };
  console.log = (l: string) => grab(l);
  console.warn = (l: string) => grab(l);
  console.error = (l: string) => grab(l);
  try {
    await fn();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}

after(() => {
  // node:test keeps the process alive if timers linger; nothing to clean here.
});

test("redact hides secret-looking keys but keeps benign values", () => {
  const out = redact({
    task: "add rate limiting",
    apiKey: "sk-live-123",
    nested: { authorization: "Bearer xyz", ok: 1 },
    list: [{ password: "p" }, "plain"],
  }) as Record<string, any>;

  assert.equal(out.task, "add rate limiting");
  assert.equal(out.apiKey, "[REDACTED]");
  assert.equal(out.nested.authorization, "[REDACTED]");
  assert.equal(out.nested.ok, 1);
  assert.equal(out.list[0].password, "[REDACTED]");
  assert.equal(out.list[1], "plain");
});

test("log emits a single structured JSON line with ts/level/event", async () => {
  const lines = await captureLogs(async () => {
    log("info", "unit_test", { token: "should-hide", keep: "value" });
  });
  assert.equal(lines.length, 1);
  const entry = lines[0] as Record<string, any>;
  assert.equal(entry.event, "unit_test");
  assert.equal(entry.level, "info");
  assert.ok(typeof entry.ts === "string" && entry.ts.length > 0);
  assert.equal(entry.token, "[REDACTED]");
  assert.equal(entry.keep, "value");
});

test("tool_call is logged with latency and request/session context", async () => {
  const env = makeEnv();
  const lines = await captureLogs(async () => {
    const res = await worker.fetch(rpc("tools/call", { name: "get_scope_instructions" }), env);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.result.content[0].text.length > 0);
  });

  const toolLog = lines.find((l) => l.event === "tool_call") as Record<string, any>;
  assert.ok(toolLog, "expected a tool_call log entry");
  assert.equal(toolLog.tool, "get_scope_instructions");
  assert.equal(toolLog.status, "ok");
  assert.equal(toolLog.sessionId, "sess-abc");
  assert.ok(typeof toolLog.requestId === "string");
  assert.ok(Number.isInteger(toolLog.durationMs) && toolLog.durationMs >= 0);
  assert.ok(toolLog.durationMs < LATENCY_BUDGET_MS, "demo tool should be well under budget");
});

test("tool errors are logged with useful context and redacted args", async () => {
  const env = makeEnv();
  const lines = await captureLogs(async () => {
    const res = await worker.fetch(
      rpc("tools/call", { name: "get_plan", arguments: { plan_id: "missing", apiKey: "sk-secret" } }),
      env,
    );
    const body = (await res.json()) as any;
    assert.ok(body.error, "expected a JSON-RPC error");
  });

  const errLog = lines.find((l) => l.event === "tool_call" && l.status === "error") as Record<string, any>;
  assert.ok(errLog, "expected an error log entry");
  assert.equal(errLog.tool, "get_plan");
  assert.ok(typeof errLog.error === "string" && errLog.error.length > 0);
  assert.equal(errLog.args.apiKey, "[REDACTED]");
  assert.equal(errLog.args.plan_id, "missing");
});

test("concurrent sessions get distinct requestIds and stay under budget", async () => {
  const env = makeEnv();
  const N = 25;

  const lines = await captureLogs(async () => {
    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        worker.fetch(rpc("tools/call", { name: "decompose_task", arguments: { task: `t${i}` } }, i), env),
      ),
    );
    for (const res of responses) {
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      assert.ok(body.result, "concurrent call should succeed");
    }
  });

  const toolLogs = lines.filter((l) => l.event === "tool_call");
  assert.equal(toolLogs.length, N);
  const ids = new Set(toolLogs.map((l) => l.requestId));
  assert.equal(ids.size, N, "each concurrent request must have a unique requestId");

  const durations = toolLogs.map((l) => l.durationMs as number);
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  assert.ok(avg < LATENCY_BUDGET_MS, `avg latency ${avg}ms should be < ${LATENCY_BUDGET_MS}ms`);
});
