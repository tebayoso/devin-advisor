import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getPlan,
  insertPlan,
  queryMemory,
  saveMemory,
} from "../src/db.js";
import type { Decomposition } from "../src/types.js";

const decomposition: Decomposition = {
  subtasks: [
    {
      id: "s1",
      title: "Do the thing",
      description: "A subtask",
      confidence: "high",
      justification: "It is easy",
      dependsOn: [],
    },
  ],
  executionStrategy: "sequential",
  estimatedComplexity: "medium",
  confidenceSummary: "Looks good",
};

async function clearTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM plans"),
    env.DB.prepare("DELETE FROM memory"),
    env.DB.prepare("DELETE FROM reviews"),
  ]);
}

beforeEach(clearTables);

describe("plans persistence", () => {
  it("inserts a plan and reads it back with round-tripped JSON", async () => {
    const plan = await insertPlan(env, {
      workspace: "ws-1",
      originalTask: "Build a widget",
      decomposition,
      confidenceSummary: "Looks good",
    });

    expect(plan.id).toMatch(/[0-9a-f-]{36}/);
    expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const fetched = await getPlan(env, plan.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.originalTask).toBe("Build a widget");
    expect(fetched?.workspace).toBe("ws-1");
    expect(fetched?.decomposition).toEqual(decomposition);
    expect(fetched?.confidenceSummary).toBe("Looks good");
  });

  it("persists a plan with null workspace and null confidence summary", async () => {
    const plan = await insertPlan(env, {
      workspace: null,
      originalTask: "No workspace task",
      decomposition,
      confidenceSummary: null,
    });

    const fetched = await getPlan(env, plan.id);
    expect(fetched?.workspace).toBeNull();
    expect(fetched?.confidenceSummary).toBeNull();
  });

  it("returns null for an unknown plan id", async () => {
    expect(await getPlan(env, "does-not-exist")).toBeNull();
  });

  it("gives each inserted plan a unique id", async () => {
    const a = await insertPlan(env, {
      workspace: null,
      originalTask: "A",
      decomposition,
      confidenceSummary: null,
    });
    const b = await insertPlan(env, {
      workspace: null,
      originalTask: "B",
      decomposition,
      confidenceSummary: null,
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("memory persistence", () => {
  it("saves a memory entry and finds it by key, value, or tag", async () => {
    await saveMemory(env, {
      workspace: "ws-1",
      key: "retry-pattern",
      value: "Retry flaky network calls with backoff",
      tags: ["networking", "resilience"],
    });

    const byKey = await queryMemory(env, "ws-1", "retry-pattern");
    expect(byKey).toHaveLength(1);
    expect(byKey[0].tags).toEqual(["networking", "resilience"]);

    const byValue = await queryMemory(env, "ws-1", "backoff");
    expect(byValue).toHaveLength(1);

    const byTag = await queryMemory(env, "ws-1", "resilience");
    expect(byTag).toHaveLength(1);
  });

  it("scopes queries by workspace", async () => {
    await saveMemory(env, {
      workspace: "ws-1",
      key: "k",
      value: "scoped value",
      tags: [],
    });
    await saveMemory(env, {
      workspace: "ws-2",
      key: "k",
      value: "scoped value",
      tags: [],
    });

    const ws1 = await queryMemory(env, "ws-1", "scoped");
    expect(ws1).toHaveLength(1);
    expect(ws1[0].workspace).toBe("ws-1");
  });

  it("with a null workspace returns entries across all workspaces", async () => {
    await saveMemory(env, { workspace: "ws-1", key: "k1", value: "shared term", tags: [] });
    await saveMemory(env, { workspace: "ws-2", key: "k2", value: "shared term", tags: [] });
    await saveMemory(env, { workspace: null, key: "k3", value: "shared term", tags: [] });

    const all = await queryMemory(env, null, "shared");
    expect(all).toHaveLength(3);
  });

  it("returns an empty array when nothing matches", async () => {
    await saveMemory(env, { workspace: "ws-1", key: "k", value: "v", tags: [] });
    expect(await queryMemory(env, "ws-1", "no-such-term")).toEqual([]);
  });

  it("handles entries with no tags", async () => {
    await saveMemory(env, { workspace: "ws-1", key: "notags", value: "value", tags: [] });
    const results = await queryMemory(env, "ws-1", "notags");
    expect(results[0].tags).toEqual([]);
  });

  it("orders results by most recent first", async () => {
    await saveMemory(env, { workspace: "ws-1", key: "old", value: "term one", tags: [] });
    // Ensure a distinct createdAt timestamp for deterministic ordering.
    await new Promise((r) => setTimeout(r, 5));
    await saveMemory(env, { workspace: "ws-1", key: "new", value: "term two", tags: [] });

    const results = await queryMemory(env, "ws-1", "term");
    expect(results).toHaveLength(2);
    expect(results[0].key).toBe("new");
    expect(results[1].key).toBe("old");
  });
});
