import assert from "node:assert/strict";
import { test } from "node:test";

import { getPlan, insertPlan, normalizeWorkspace, queryMemory, saveMemory } from "../src/db.js";
import { callTool } from "../src/tools.js";
import type { Decomposition, Env } from "../src/types.js";

// Minimal in-memory D1 stand-in that understands the exact prepared statements
// used by src/db.ts. Rows are stored in plain arrays so tests exercise the real
// query-building/scoping logic in db.ts.
interface Row {
  [key: string]: unknown;
}

function makeFakeDb() {
  const plans: Row[] = [];
  const memory: Row[] = [];

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bound = args;
        return stmt;
      },
      async run() {
        if (sql.includes("INSERT INTO plans")) {
          const [id, workspace, original_task, decomposition, confidence_summary, created_at] =
            bound;
          plans.push({ id, workspace, original_task, decomposition, confidence_summary, created_at });
        } else if (sql.includes("INSERT INTO memory")) {
          const [id, workspace, key, value, tags, created_at] = bound;
          memory.push({ id, workspace, key, value, tags, created_at });
        }
        return { success: true };
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes("FROM plans WHERE id = ? AND workspace = ?")) {
          const [id, workspace] = bound;
          const hit = plans.find((r) => r.id === id && r.workspace === workspace);
          return (hit as T) ?? null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes("FROM memory")) {
          const [workspace] = bound;
          const results = memory.filter((r) => r.workspace === workspace);
          return { results: results as T[] };
        }
        return { results: [] };
      },
    };
    return stmt;
  }

  return { DB: { prepare } as unknown as Env["DB"], plans, memory };
}

const decomposition: Decomposition = {
  subtasks: [],
  executionStrategy: "sequential",
  estimatedComplexity: "low",
  confidenceSummary: "n/a",
};

test("normalizeWorkspace falls back to the default bucket, never a wildcard", () => {
  assert.equal(normalizeWorkspace(undefined), "default");
  assert.equal(normalizeWorkspace(null), "default");
  assert.equal(normalizeWorkspace("  "), "default");
  assert.equal(normalizeWorkspace("acme"), "acme");
  assert.equal(normalizeWorkspace("  acme  "), "acme");
});

test("getPlan is scoped: a plan is invisible from another workspace", async () => {
  const { DB } = makeFakeDb();
  const env = { DB } as Env;
  const plan = await insertPlan(env, {
    workspace: "acme",
    originalTask: "ship it",
    decomposition,
    confidenceSummary: null,
  });

  assert.equal((await getPlan(env, plan.id, "acme"))?.id, plan.id);
  assert.equal(await getPlan(env, plan.id, "evil-corp"), null);
  assert.equal(await getPlan(env, plan.id, undefined), null); // default workspace
});

test("queryMemory never leaks across workspaces, even with no workspace given", async () => {
  const { DB } = makeFakeDb();
  const env = { DB } as Env;
  await saveMemory(env, { workspace: "acme", key: "k", value: "secret-acme", tags: [] });
  await saveMemory(env, { workspace: "beta", key: "k", value: "secret-beta", tags: [] });

  const acme = await queryMemory(env, "acme", "secret");
  assert.deepEqual(acme.map((m) => m.value), ["secret-acme"]);

  const beta = await queryMemory(env, "beta", "secret");
  assert.deepEqual(beta.map((m) => m.value), ["secret-beta"]);

  // A missing workspace maps to "default" and must not return other tenants' rows.
  const none = await queryMemory(env, undefined, "secret");
  assert.deepEqual(none, []);
});

test("run_adversarial_review rejects a plan_id from a different workspace", async () => {
  const { DB } = makeFakeDb();
  const env = { DB } as Env;
  const { plan_id } = (await callTool(env, "save_plan", {
    original_task: "t",
    decomposition,
    workspace: "acme",
  })) as { plan_id: string };

  await assert.doesNotReject(callTool(env, "run_adversarial_review", { plan_id, workspace: "acme" }));
  await assert.rejects(
    callTool(env, "run_adversarial_review", { plan_id, workspace: "other" }),
    /Plan not found/,
  );
});

test("get_plan tool enforces workspace scoping", async () => {
  const { DB } = makeFakeDb();
  const env = { DB } as Env;
  const { plan_id } = (await callTool(env, "save_plan", {
    original_task: "t",
    decomposition,
    workspace: "acme",
  })) as { plan_id: string };

  await assert.rejects(callTool(env, "get_plan", { plan_id, workspace: "other" }), /Plan not found/);
  const ok = (await callTool(env, "get_plan", { plan_id, workspace: "acme" })) as { id: string };
  assert.equal(ok.id, plan_id);
});
