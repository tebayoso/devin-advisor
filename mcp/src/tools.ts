import { getPlan, insertPlan, queryMemory, saveMemory } from "./db.js";
import { SCOPE_INSTRUCTIONS } from "./instructions.js";
import type {
  AdversarialReview,
  Decomposition,
  Env,
  ToolDefinition,
} from "./types.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_scope_instructions",
    description:
      "Return the full devin-scope planning workflow the agent must follow (decompose -> adversarial review -> save -> verification).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "decompose_task",
    description:
      "Decompose an ambiguous task into 3-7 subtasks with per-subtask confidence and a recommended execution strategy.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The original ambiguous task." },
        context: { type: "string", description: "Optional extra context (repo, constraints)." },
        workspace: { type: "string", description: "Optional workspace id for memory scoping." },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "run_adversarial_review",
    description:
      "Produce a structured adversarial critique of a plan: weak assumptions, missing edge cases, risks, recommended changes.",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: { type: "string", description: "Id returned by save_plan." },
        original_task: { type: "string", description: "The original task for context." },
      },
      required: ["plan_id"],
      additionalProperties: false,
    },
  },
  {
    name: "save_plan",
    description: "Persist a plan (decomposition) to shared memory and return a plan_id.",
    inputSchema: {
      type: "object",
      properties: {
        original_task: { type: "string" },
        decomposition: { type: "object" },
        workspace: { type: "string" },
      },
      required: ["original_task", "decomposition"],
      additionalProperties: false,
    },
  },
  {
    name: "get_plan",
    description: "Retrieve a previously saved plan by plan_id.",
    inputSchema: {
      type: "object",
      properties: { plan_id: { type: "string" } },
      required: ["plan_id"],
      additionalProperties: false,
    },
  },
  {
    name: "save_memory",
    description: "Store a key/value learning (with tags), scoped by workspace.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        workspace: { type: "string" },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "query_memory",
    description: "Search stored memory by text, scoped by workspace.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        workspace: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_verification_checklist",
    description: "Return a concrete self-verification checklist to satisfy before proposing a PR.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

// NOTE (scaffold): decompose_task and run_adversarial_review currently return a
// deterministic skeleton. Full model-backed generation is tracked in the roadmap issues.
function skeletonDecomposition(task: string): Decomposition {
  return {
    subtasks: [
      {
        id: "s1",
        title: `Clarify requirements for: ${task}`,
        description: "Resolve ambiguities and define acceptance criteria before implementation.",
        confidence: "high",
        justification: "Scoping is well-understood and low-risk.",
        dependsOn: [],
      },
    ],
    executionStrategy: "sequential",
    estimatedComplexity: "medium",
    confidenceSummary: "Skeleton decomposition; refine with model-backed generation.",
  };
}

function skeletonReview(): AdversarialReview {
  return {
    weakAssumptions: ["The task description is complete."],
    missingEdgeCases: ["Failure/error paths not yet enumerated."],
    risks: [{ description: "Underspecified requirements", score: 3 }],
    recommendedChanges: ["Add explicit acceptance criteria and edge-case subtasks."],
    confidenceAdjustment: "Lower overall confidence until requirements are confirmed.",
  };
}

export async function callTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_scope_instructions":
      return { instructions: SCOPE_INSTRUCTIONS };

    case "decompose_task": {
      const task = str(args, "task");
      if (!task) throw new Error("`task` is required");
      return skeletonDecomposition(task);
    }

    case "run_adversarial_review": {
      const planId = str(args, "plan_id");
      if (!planId) throw new Error("`plan_id` is required");
      return skeletonReview();
    }

    case "save_plan": {
      const originalTask = str(args, "original_task");
      const decomposition = args.decomposition as Decomposition | undefined;
      if (!originalTask || !decomposition) {
        throw new Error("`original_task` and `decomposition` are required");
      }
      const plan = await insertPlan(env, {
        workspace: str(args, "workspace") ?? null,
        originalTask,
        decomposition,
        confidenceSummary: decomposition.confidenceSummary ?? null,
      });
      return { plan_id: plan.id };
    }

    case "get_plan": {
      const planId = str(args, "plan_id");
      if (!planId) throw new Error("`plan_id` is required");
      const plan = await getPlan(env, planId);
      if (!plan) throw new Error(`Plan not found: ${planId}`);
      return plan;
    }

    case "save_memory": {
      const key = str(args, "key");
      const value = str(args, "value");
      if (!key || !value) throw new Error("`key` and `value` are required");
      const tags = Array.isArray(args.tags) ? (args.tags as string[]) : [];
      const entry = await saveMemory(env, {
        workspace: str(args, "workspace") ?? null,
        key,
        value,
        tags,
      });
      return { id: entry.id };
    }

    case "query_memory": {
      const query = str(args, "query");
      if (!query) throw new Error("`query` is required");
      const results = await queryMemory(env, str(args, "workspace") ?? null, query);
      return { results };
    }

    case "get_verification_checklist":
      return {
        checklist: [
          "All new/changed code has tests and they pass.",
          "Lint and typecheck pass.",
          "Edge cases from the adversarial review are covered.",
          "Computer-use / visual verification done where the change is user-facing.",
          "No unrelated files or security controls were modified.",
        ],
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
