import {
  getPlan,
  insertPlan,
  insertReview,
  normalizeWorkspace,
  queryMemory,
  saveMemory,
} from "./db.js";
import { decomposeTask } from "./decompose.js";
import { devinApiConfigured, runCriticSession } from "./devin.js";
import { SCOPE_INSTRUCTIONS } from "./instructions.js";
import { DEFAULT_PROMOTION_THRESHOLD, promotePlan } from "./promotion.js";
import { buildAdversarialReview, extractKeywords } from "./review.js";
import { suggestRouting } from "./routing.js";
import {
  createTicketClient,
  formatPlanComment,
  parseTicketRef,
  ticketToTask,
} from "./tickets.js";
import type {
  AdversarialReview,
  Decomposition,
  Env,
  MemoryEntry,
  PromotionTarget,
  TicketProvider,
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
      "Decompose an ambiguous task into 3-7 subtasks with per-subtask confidence, a recommended execution strategy, and cost/confidence routing suggestions (model tier, local vs cloud, parallel managed Devins).",
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
      "Produce a structured, categorized adversarial critique of a saved plan: weak assumptions, missing edge cases, quantified/explained risk scores, recommended changes, and an overall confidence adjustment — informed by relevant historical memory. Persists the review to D1 linked to the plan.",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: { type: "string", description: "Id returned by save_plan." },
        original_task: { type: "string", description: "The original task for context." },
        workspace: {
          type: "string",
          description: "Workspace the plan belongs to. Must match the plan's workspace.",
        },
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
    description: "Retrieve a previously saved plan by plan_id, scoped to its workspace.",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        workspace: {
          type: "string",
          description: "Workspace the plan belongs to. Must match the plan's workspace.",
        },
      },
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
    name: "scope_ticket",
    description:
      "Ingest a Linear/Jira ticket (id or URL), fetch its content, and decompose it into a scoping plan.",
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string", description: "Ticket id (e.g. ENG-123) or full URL." },
        provider: {
          type: "string",
          enum: ["linear", "jira"],
          description: "Required when passing a bare id; inferred from URLs.",
        },
        context: { type: "string", description: "Optional extra context (repo, constraints)." },
        workspace: { type: "string", description: "Optional workspace id for memory scoping." },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
  },
  {
    name: "post_plan_to_ticket",
    description:
      "Post a previously saved plan back to its Linear/Jira ticket as a comment.",
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string", description: "Ticket id (e.g. ENG-123) or full URL." },
        provider: {
          type: "string",
          enum: ["linear", "jira"],
          description: "Required when passing a bare id; inferred from URLs.",
        },
        plan_id: { type: "string", description: "Id returned by save_plan." },
        workspace: {
          type: "string",
          description: "Workspace the plan belongs to. Must match the plan's workspace.",
        },
      },
      required: ["ticket", "plan_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_verification_checklist",
    description: "Return a concrete self-verification checklist to satisfy before proposing a PR.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "promote_plan",
    description:
      "Assess a saved plan against 'high-quality' heuristics and, when it qualifies, generate a Knowledge note or Playbook artifact plus the official Devin MCP calls to persist it (PRD §12).",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: { type: "string", description: "Id returned by save_plan." },
        workspace: {
          type: "string",
          description: "Workspace the plan belongs to. Must match the plan's workspace.",
        },
        review: {
          type: "object",
          description:
            "The adversarial review from run_adversarial_review, so the promoter can confirm the plan was well-reviewed.",
        },
        review_incorporated: {
          type: "boolean",
          description: "Whether the adversarial findings were incorporated into the plan.",
        },
        target: {
          type: "string",
          enum: ["knowledge", "playbook"],
          description: "Promotion target. Defaults to 'knowledge'.",
        },
        threshold: {
          type: "number",
          description: `Quality score (0-100) required to qualify. Defaults to ${DEFAULT_PROMOTION_THRESHOLD}.`,
        },
      },
      required: ["plan_id"],
      additionalProperties: false,
    },
  },
];

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

function providerHint(args: Record<string, unknown>): TicketProvider | undefined {
  const v = args.provider;
  return v === "linear" || v === "jira" ? v : undefined;
}

type FetchLike = typeof fetch;

// Pull memory entries relevant to a task by querying the top keywords and
// merging unique results (query_memory matches substrings, so per-keyword
// queries retrieve far more useful history than the raw task string).
async function relevantMemory(
  env: Env,
  workspace: string | null,
  originalTask: string,
): Promise<MemoryEntry[]> {
  const keywords = extractKeywords(originalTask);
  const queries = keywords.length ? keywords : [originalTask];
  const byId = new Map<string, MemoryEntry>();
  for (const q of queries) {
    const results = await queryMemory(env, workspace, q);
    for (const entry of results) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

export async function callTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<unknown> {
  switch (name) {
    case "get_scope_instructions":
      return { instructions: SCOPE_INSTRUCTIONS };

    case "decompose_task": {
      const task = str(args, "task");
      if (!task) throw new Error("`task` is required");
      return decomposeTask(env, task, str(args, "context"));
    }

    case "run_adversarial_review": {
      const planId = str(args, "plan_id");
      if (!planId) throw new Error("`plan_id` is required");
      const workspace = normalizeWorkspace(str(args, "workspace"));
      // Verify the plan exists in the caller's workspace before reviewing it so
      // a plan_id from another workspace cannot be reviewed cross-tenant.
      const plan = await getPlan(env, planId, workspace);
      if (!plan) throw new Error(`Plan not found: ${planId}`);
      const originalTask = str(args, "original_task") ?? plan.originalTask;
      const memory = await relevantMemory(env, plan.workspace, originalTask);

      // Modo A: rich in-agent adversarial review (also the fallback for Modo B).
      const buildModeA = (): AdversarialReview => ({
        ...buildAdversarialReview(originalTask, plan.decomposition, memory),
        mode: "in-agent",
      });

      let review: AdversarialReview;
      // Modo B: delegate to a separate critic Devin session when configured,
      // gracefully falling back to Modo A on any failure.
      if (devinApiConfigured(env)) {
        try {
          review = await runCriticSession(env, plan, originalTask);
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Critic session failed";
          review = { ...buildModeA(), fallbackReason: reason };
        }
      } else {
        review = buildModeA();
      }

      const { id: reviewId } = await insertReview(env, planId, review, plan.workspace);
      return { review_id: reviewId, plan_id: planId, ...review };
    }

    case "save_plan": {
      const originalTask = str(args, "original_task");
      const decomposition = args.decomposition as Decomposition | undefined;
      if (!originalTask || !decomposition) {
        throw new Error("`original_task` and `decomposition` are required");
      }
      // Backfill routing suggestions if the caller supplied a decomposition without them.
      if (!decomposition.routing && Array.isArray(decomposition.subtasks)) {
        decomposition.routing = suggestRouting(
          decomposition.subtasks,
          decomposition.estimatedComplexity ?? "medium",
          decomposition.executionStrategy ?? "sequential",
        );
      }
      const plan = await insertPlan(env, {
        workspace: normalizeWorkspace(str(args, "workspace")),
        originalTask,
        decomposition,
        confidenceSummary: decomposition.confidenceSummary ?? null,
      });
      return { plan_id: plan.id };
    }

    case "scope_ticket": {
      const ticketInput = str(args, "ticket");
      if (!ticketInput) throw new Error("`ticket` is required");
      const ref = parseTicketRef(ticketInput, providerHint(args));
      const client = createTicketClient(ref.provider, env, fetchImpl);
      const ticket = await client.fetchTicket(ref.id);
      const context = str(args, "context");
      const task = ticketToTask(ticket);
      return { ticket, task, decomposition: await decomposeTask(env, task, context) };
    }

    case "post_plan_to_ticket": {
      const ticketInput = str(args, "ticket");
      const planId = str(args, "plan_id");
      if (!ticketInput || !planId) {
        throw new Error("`ticket` and `plan_id` are required");
      }
      const plan = await getPlan(env, planId, normalizeWorkspace(str(args, "workspace")));
      if (!plan) throw new Error(`Plan not found: ${planId}`);
      const ref = parseTicketRef(ticketInput, providerHint(args));
      const client = createTicketClient(ref.provider, env, fetchImpl);
      const { url } = await client.postComment(ref.id, formatPlanComment(plan));
      return { posted: true, provider: ref.provider, ticket_id: ref.id, comment_url: url ?? null };
    }

    case "get_plan": {
      const planId = str(args, "plan_id");
      if (!planId) throw new Error("`plan_id` is required");
      const plan = await getPlan(env, planId, normalizeWorkspace(str(args, "workspace")));
      if (!plan) throw new Error(`Plan not found: ${planId}`);
      return plan;
    }

    case "save_memory": {
      const key = str(args, "key");
      const value = str(args, "value");
      if (!key || !value) throw new Error("`key` and `value` are required");
      const tags = Array.isArray(args.tags) ? (args.tags as string[]) : [];
      const entry = await saveMemory(env, {
        workspace: normalizeWorkspace(str(args, "workspace")),
        key,
        value,
        tags,
      });
      return { id: entry.id };
    }

    case "query_memory": {
      const query = str(args, "query");
      if (!query) throw new Error("`query` is required");
      const results = await queryMemory(env, normalizeWorkspace(str(args, "workspace")), query);
      return { results };
    }

    case "promote_plan": {
      const planId = str(args, "plan_id");
      if (!planId) throw new Error("`plan_id` is required");
      const plan = await getPlan(env, planId, normalizeWorkspace(str(args, "workspace")));
      if (!plan) throw new Error(`Plan not found: ${planId}`);
      const review =
        args.review && typeof args.review === "object"
          ? (args.review as AdversarialReview)
          : undefined;
      const target =
        args.target === "knowledge" || args.target === "playbook"
          ? (args.target as PromotionTarget)
          : undefined;
      const threshold = typeof args.threshold === "number" ? args.threshold : undefined;
      return promotePlan({
        plan,
        review,
        reviewIncorporated: args.review_incorporated === true,
        target,
        threshold,
      });
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
