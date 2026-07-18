import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { callTool, TOOL_DEFINITIONS } from "../../src/tools.js";
import { SCOPE_INSTRUCTIONS } from "../../src/instructions.js";
import type { AdversarialReview, Decomposition, Plan } from "../../src/types.js";

const decomposition: Decomposition = {
  subtasks: [
    {
      id: "s1",
      title: "Subtask",
      description: "desc",
      confidence: "medium",
      justification: "why",
      dependsOn: [],
    },
  ],
  executionStrategy: "parallel",
  estimatedComplexity: "low",
  confidenceSummary: "summary",
};

async function clearTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM plans"),
    env.DB.prepare("DELETE FROM memory"),
  ]);
}

beforeEach(clearTables);

describe("tool definitions contract", () => {
  const expectedTools = [
    "get_scope_instructions",
    "decompose_task",
    "run_adversarial_review",
    "save_plan",
    "get_plan",
    "save_memory",
    "query_memory",
    "get_verification_checklist",
    "promote_plan",
    "scope_ticket",
    "post_plan_to_ticket",
  ];

  it("exposes exactly the documented tools", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([...expectedTools].sort());
  });

  it("every tool has a non-empty description and an object input schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(0);
      const schema = tool.inputSchema as { type?: string; required?: unknown };
      expect(schema.type).toBe("object");
    }
  });

  it("declares required fields as strings that exist in properties", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const schema = tool.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const required = schema.required ?? [];
      const properties = schema.properties ?? {};
      for (const field of required) {
        expect(typeof field).toBe("string");
        expect(properties).toHaveProperty(field);
      }
    }
  });
});

describe("get_scope_instructions", () => {
  it("returns the full instructions text", async () => {
    const out = (await callTool(env, "get_scope_instructions", {})) as {
      instructions: string;
    };
    expect(out.instructions).toBe(SCOPE_INSTRUCTIONS);
    expect(out.instructions).toContain("devin-scope");
  });
});

describe("decompose_task", () => {
  it("returns a decomposition skeleton referencing the task", async () => {
    const out = (await callTool(env, "decompose_task", {
      task: "Migrate the billing service",
    })) as Decomposition;
    expect(out.subtasks.length).toBeGreaterThan(0);
    expect(out.subtasks[0].title).toContain("Migrate the billing service");
    expect(out.executionStrategy).toBe("sequential");
    expect(["low", "medium", "high"]).toContain(out.estimatedComplexity);
  });

  it("throws when task is missing", async () => {
    await expect(callTool(env, "decompose_task", {})).rejects.toThrow("`task` is required");
  });

  it("throws when task is not a string", async () => {
    await expect(callTool(env, "decompose_task", { task: 42 })).rejects.toThrow(
      "`task` is required",
    );
  });
});

describe("run_adversarial_review", () => {
  it("returns a structured review", async () => {
    const saved = (await callTool(env, "save_plan", {
      original_task: "Ship feature X",
      decomposition,
      workspace: "ws-review",
    })) as { plan_id: string };

    const out = (await callTool(env, "run_adversarial_review", {
      plan_id: saved.plan_id,
      workspace: "ws-review",
    })) as AdversarialReview;
    expect(Array.isArray(out.weakAssumptions)).toBe(true);
    expect(Array.isArray(out.missingEdgeCases)).toBe(true);
    expect(Array.isArray(out.risks)).toBe(true);
    expect(out.risks[0]).toHaveProperty("score");
    expect(typeof out.confidenceAdjustment).toBe("string");
  });

  it("throws when plan_id is missing", async () => {
    await expect(callTool(env, "run_adversarial_review", {})).rejects.toThrow(
      "`plan_id` is required",
    );
  });
});

describe("save_plan / get_plan", () => {
  it("saves a plan and retrieves it by id", async () => {
    const saved = (await callTool(env, "save_plan", {
      original_task: "Ship feature X",
      decomposition,
      workspace: "ws-9",
    })) as { plan_id: string };
    expect(saved.plan_id).toMatch(/[0-9a-f-]{36}/);

    const plan = (await callTool(env, "get_plan", {
      plan_id: saved.plan_id,
      workspace: "ws-9",
    })) as Plan;
    expect(plan.originalTask).toBe("Ship feature X");
    expect(plan.workspace).toBe("ws-9");
    expect(plan.decomposition).toEqual(decomposition);
    expect(plan.confidenceSummary).toBe("summary");
  });

  it("save_plan throws when original_task is missing", async () => {
    await expect(callTool(env, "save_plan", { decomposition })).rejects.toThrow(
      "`original_task` and `decomposition` are required",
    );
  });

  it("save_plan throws when decomposition is missing", async () => {
    await expect(
      callTool(env, "save_plan", { original_task: "task only" }),
    ).rejects.toThrow("`original_task` and `decomposition` are required");
  });

  it("get_plan throws when plan_id is missing", async () => {
    await expect(callTool(env, "get_plan", {})).rejects.toThrow("`plan_id` is required");
  });

  it("get_plan throws for an unknown plan id", async () => {
    await expect(callTool(env, "get_plan", { plan_id: "nope" })).rejects.toThrow(
      "Plan not found: nope",
    );
  });
});

describe("save_memory / query_memory", () => {
  it("saves memory and finds it via query", async () => {
    const saved = (await callTool(env, "save_memory", {
      key: "insight",
      value: "Prefer batched D1 writes",
      tags: ["d1", "perf"],
      workspace: "ws-5",
    })) as { id: string };
    expect(saved.id).toMatch(/[0-9a-f-]{36}/);

    const found = (await callTool(env, "query_memory", {
      query: "batched",
      workspace: "ws-5",
    })) as { results: { key: string; tags: string[] }[] };
    expect(found.results).toHaveLength(1);
    expect(found.results[0].key).toBe("insight");
    expect(found.results[0].tags).toEqual(["d1", "perf"]);
  });

  it("defaults tags to an empty array when not provided", async () => {
    await callTool(env, "save_memory", { key: "k", value: "no tags here" });
    const found = (await callTool(env, "query_memory", { query: "no tags" })) as {
      results: { tags: string[] }[];
    };
    expect(found.results[0].tags).toEqual([]);
  });

  it("ignores a non-array tags value", async () => {
    await callTool(env, "save_memory", {
      key: "k2",
      value: "bad tags value",
      tags: "not-an-array",
    });
    const found = (await callTool(env, "query_memory", { query: "bad tags" })) as {
      results: { tags: string[] }[];
    };
    expect(found.results[0].tags).toEqual([]);
  });

  it("save_memory throws when key is missing", async () => {
    await expect(callTool(env, "save_memory", { value: "v" })).rejects.toThrow(
      "`key` and `value` are required",
    );
  });

  it("save_memory throws when value is missing", async () => {
    await expect(callTool(env, "save_memory", { key: "k" })).rejects.toThrow(
      "`key` and `value` are required",
    );
  });

  it("query_memory throws when query is missing", async () => {
    await expect(callTool(env, "query_memory", {})).rejects.toThrow("`query` is required");
  });

  it("query_memory returns an empty result set when nothing matches", async () => {
    const found = (await callTool(env, "query_memory", { query: "absent" })) as {
      results: unknown[];
    };
    expect(found.results).toEqual([]);
  });
});

describe("get_verification_checklist", () => {
  it("returns a non-empty checklist", async () => {
    const out = (await callTool(env, "get_verification_checklist", {})) as {
      checklist: string[];
    };
    expect(Array.isArray(out.checklist)).toBe(true);
    expect(out.checklist.length).toBeGreaterThan(0);
  });
});

describe("unknown tool", () => {
  it("throws for an unrecognized tool name", async () => {
    await expect(callTool(env, "no_such_tool", {})).rejects.toThrow(
      "Unknown tool: no_such_tool",
    );
  });
});
