// Model-backed task decomposition for the `decompose_task` tool.
//
// When a Cloudflare Workers AI binding is configured (`env.AI`), a carefully
// engineered prompt is used to generate 3-7 well-scoped subtasks with calibrated
// confidence and an execution-strategy recommendation. The model output is
// strictly validated and normalized so the tool always honors the structured
// JSON contract from PRD 6.2 (Tool 2). If the binding is missing or the model
// call fails/returns unusable output, a strong heuristic decomposition is used
// as a deterministic fallback.

import type {
  Confidence,
  Decomposition,
  Env,
  ExecutionStrategy,
  Subtask,
} from "./types.js";

const DEFAULT_MODEL = "@cf/meta/llama-3-8b-instruct";
const MIN_SUBTASKS = 3;
const MAX_SUBTASKS = 7;

type Complexity = Decomposition["estimatedComplexity"];

const CONFIDENCE_VALUES: readonly Confidence[] = ["high", "medium", "low"];
const STRATEGY_VALUES: readonly ExecutionStrategy[] = [
  "parallel",
  "sequential",
  "managed-devins",
];
const COMPLEXITY_VALUES: readonly Complexity[] = ["low", "medium", "high"];

// ---------------------------------------------------------------------------
// Prompt design
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the planning engine of devin-scope, an expert software delivery planner for autonomous Devin agents. Your job is to turn one ambiguous engineering task into a concrete, well-scoped execution plan.

Produce between ${MIN_SUBTASKS} and ${MAX_SUBTASKS} subtasks. Each subtask must be:
- Independently understandable, action-oriented, and small enough to reason about (roughly one focused unit of work).
- Ordered so dependencies are explicit via "dependsOn" (list the ids of subtasks that must finish first). Use [] for subtasks with no prerequisites.
- Free of overlap with the other subtasks (no duplicated work).

For every subtask assign a CALIBRATED confidence and a one-sentence justification:
- "high": the work is well understood, low risk, and success criteria are clear (e.g. scoping, reading existing code, writing focused tests).
- "medium": the approach is mostly clear but has design decisions, integration surface, or moderate unknowns.
- "low": significant ambiguity, external dependencies, migration/perf/security risk, or unclear acceptance criteria.
Calibrate honestly: an ambiguous task with vague success criteria should NOT be mostly "high". Reserve "high" for genuinely low-risk work.

Recommend exactly one executionStrategy:
- "sequential": subtasks form a dependency chain and must run in order.
- "parallel": several subtasks are independent, small, and can run at once by one agent.
- "managed-devins": several independent, substantial workstreams that are best delegated to separate managed Devin sessions running concurrently (high overall complexity + low coupling).

Also set estimatedComplexity ("low" | "medium" | "high") for the whole task and a one-paragraph confidenceSummary that states the overall confidence, why, and the recommended strategy.

Respond with STRICT JSON ONLY (no markdown, no prose, no code fences) matching exactly:
{
  "subtasks": [
    { "id": "s1", "title": "string", "description": "string", "confidence": "high|medium|low", "justification": "string", "dependsOn": ["s0"] }
  ],
  "executionStrategy": "parallel|sequential|managed-devins",
  "estimatedComplexity": "low|medium|high",
  "confidenceSummary": "string"
}`;

export function buildDecompositionMessages(
  task: string,
  context?: string,
): RoleScopedChatInput[] {
  const userLines = [`Task: ${task.trim()}`];
  if (context && context.trim()) {
    userLines.push(`Context: ${context.trim()}`);
  }
  userLines.push(
    "Decompose this task now. Return only the JSON object described in the system message.",
  );
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userLines.join("\n\n") },
  ];
}

// ---------------------------------------------------------------------------
// Model-backed path
// ---------------------------------------------------------------------------

export async function decomposeTask(
  env: Env,
  task: string,
  context?: string,
): Promise<Decomposition> {
  if (env.AI) {
    try {
      const modelResult = await runModelDecomposition(env, task, context);
      if (modelResult) return modelResult;
    } catch {
      // Fall back to the heuristic decomposition below.
    }
  }
  return heuristicDecomposition(task, context);
}

async function runModelDecomposition(
  env: Env,
  task: string,
  context?: string,
): Promise<Decomposition | null> {
  if (!env.AI) return null;
  const model = (env.DECOMPOSE_MODEL ??
    DEFAULT_MODEL) as typeof DEFAULT_MODEL;
  const output = await env.AI.run(model, {
    messages: buildDecompositionMessages(task, context),
    temperature: 0.2,
    max_tokens: 2048,
  });

  const text = extractResponseText(output);
  if (!text) return null;
  const parsed = extractJsonObject(text);
  if (!parsed) return null;
  return coerceDecomposition(parsed, task, context);
}

function extractResponseText(output: unknown): string | null {
  if (
    output &&
    typeof output === "object" &&
    "response" in output &&
    typeof (output as { response?: unknown }).response === "string"
  ) {
    return (output as { response: string }).response;
  }
  return null;
}

// Tolerantly extract the first balanced top-level JSON object from a string
// (models occasionally wrap output in prose or code fences).
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          const value = JSON.parse(candidate);
          return value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalization / validation (applied to model output)
// ---------------------------------------------------------------------------

export function coerceDecomposition(
  raw: Record<string, unknown>,
  task: string,
  context?: string,
): Decomposition {
  const rawSubtasks = Array.isArray(raw.subtasks) ? raw.subtasks : [];
  let subtasks = rawSubtasks
    .map((entry, index) => coerceSubtask(entry, index))
    .filter((s): s is Subtask => s !== null);

  // Enforce the 3-7 contract: pad from the heuristic, or trim the tail.
  if (subtasks.length < MIN_SUBTASKS) {
    const filler = heuristicSubtasks(task, context);
    let pad = 0;
    for (const extra of filler) {
      if (subtasks.length >= MIN_SUBTASKS) break;
      if (!subtasks.some((s) => s.title.toLowerCase() === extra.title.toLowerCase())) {
        // Use a disjoint id namespace so filler ids never collide with the
        // model's s1..sN ids (which would corrupt dependsOn remapping in
        // renumber). Filler steps don't chain onto arbitrary model output.
        subtasks.push({ ...extra, id: `f${++pad}`, dependsOn: [] });
      }
    }
  }
  if (subtasks.length > MAX_SUBTASKS) {
    subtasks = subtasks.slice(0, MAX_SUBTASKS);
  }
  subtasks = renumber(subtasks);

  const complexity = normalizeComplexity(raw.estimatedComplexity) ??
    estimateComplexity(task, context, subtasks);
  const strategy = normalizeStrategy(raw.executionStrategy) ??
    deriveExecutionStrategy(subtasks, complexity);
  const summary =
    typeof raw.confidenceSummary === "string" && raw.confidenceSummary.trim()
      ? raw.confidenceSummary.trim()
      : buildConfidenceSummary(subtasks, strategy, complexity);

  return {
    subtasks,
    executionStrategy: strategy,
    estimatedComplexity: complexity,
    confidenceSummary: summary,
  };
}

function coerceSubtask(entry: unknown, index: number): Subtask | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) return null;
  const description =
    typeof obj.description === "string" && obj.description.trim()
      ? obj.description.trim()
      : title;
  const justification =
    typeof obj.justification === "string" && obj.justification.trim()
      ? obj.justification.trim()
      : "No justification provided by the model.";
  const dependsOn = Array.isArray(obj.dependsOn)
    ? obj.dependsOn.filter((d): d is string => typeof d === "string")
    : [];
  return {
    id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `s${index + 1}`,
    title,
    description,
    confidence: normalizeConfidence(obj.confidence),
    justification,
    dependsOn,
  };
}

// Reassign stable s1..sN ids and remap dependsOn references to survive
// padding/trimming.
function renumber(subtasks: Subtask[]): Subtask[] {
  const idMap = new Map<string, string>();
  subtasks.forEach((s, i) => idMap.set(s.id, `s${i + 1}`));
  return subtasks.map((s, i) => ({
    ...s,
    id: `s${i + 1}`,
    dependsOn: s.dependsOn
      .map((d) => idMap.get(d))
      .filter((d): d is string => Boolean(d) && d !== `s${i + 1}`),
  }));
}

export function normalizeConfidence(value: unknown): Confidence {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if ((CONFIDENCE_VALUES as string[]).includes(v)) return v as Confidence;
    if (v.startsWith("h")) return "high";
    if (v.startsWith("l")) return "low";
    if (v.startsWith("m")) return "medium";
  }
  if (typeof value === "number") {
    if (value >= 0.75) return "high";
    if (value >= 0.45) return "medium";
    return "low";
  }
  return "medium";
}

function normalizeStrategy(value: unknown): ExecutionStrategy | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, "-");
  if ((STRATEGY_VALUES as string[]).includes(v)) return v as ExecutionStrategy;
  if (v.includes("managed") || v.includes("devin")) return "managed-devins";
  if (v.includes("parallel") || v.includes("concurrent")) return "parallel";
  if (v.includes("sequential") || v.includes("serial") || v.includes("order")) {
    return "sequential";
  }
  return null;
}

function normalizeComplexity(value: unknown): Complexity | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if ((COMPLEXITY_VALUES as string[]).includes(v)) return v as Complexity;
  if (v.startsWith("h")) return "high";
  if (v.startsWith("l")) return "low";
  if (v.startsWith("m")) return "medium";
  return null;
}

// ---------------------------------------------------------------------------
// Execution-strategy recommendation
// ---------------------------------------------------------------------------

export function deriveExecutionStrategy(
  subtasks: Subtask[],
  complexity: Complexity,
): ExecutionStrategy {
  const ids = new Set(subtasks.map((s) => s.id));
  const independent = subtasks.filter(
    (s) => s.dependsOn.filter((d) => ids.has(d)).length === 0,
  );
  const hasDependencies = subtasks.some(
    (s) => s.dependsOn.filter((d) => ids.has(d)).length > 0,
  );

  // Many independent, substantial workstreams -> delegate to separate Devins.
  if (independent.length >= 3 && complexity === "high" && !isMostlyChain(subtasks)) {
    return "managed-devins";
  }
  // Independent, lighter work -> a single agent can fan out.
  if (independent.length >= 2 && !hasDependencies) {
    return "parallel";
  }
  if (independent.length >= 3 && independent.length >= subtasks.length - 1) {
    return "parallel";
  }
  return "sequential";
}

// True when subtasks essentially form a single linear dependency chain.
function isMostlyChain(subtasks: Subtask[]): boolean {
  const ids = new Set(subtasks.map((s) => s.id));
  const roots = subtasks.filter(
    (s) => s.dependsOn.filter((d) => ids.has(d)).length === 0,
  );
  return roots.length <= 1;
}

// ---------------------------------------------------------------------------
// Complexity + confidence summary
// ---------------------------------------------------------------------------

const RISK_KEYWORDS = [
  "migrat",
  "security",
  "auth",
  "sso",
  "oauth",
  "distributed",
  "scale",
  "scaling",
  "performance",
  "latency",
  "concurren",
  "payment",
  "billing",
  "encrypt",
  "graphql",
  "offline",
  "real-time",
  "realtime",
  "observability",
  "rate limit",
];

const AMBIGUITY_KEYWORDS = [
  "faster",
  "better",
  "improve",
  "robust",
  "scalable",
  "nice",
  "clean up",
  "cleanup",
  "somehow",
  "etc",
  "and so on",
  "make it work",
  "modern",
  "optimi",
];

function countMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((n, kw) => (lower.includes(kw) ? n + 1 : n), 0);
}

export function ambiguityScore(task: string, context?: string): number {
  const text = `${task} ${context ?? ""}`;
  let score = countMatches(text, AMBIGUITY_KEYWORDS);
  // Short, detail-free tasks are inherently more ambiguous.
  if (task.trim().split(/\s+/).length <= 6) score += 1;
  if (!/\d/.test(task)) score += 1; // no concrete numbers/targets
  return score;
}

export function estimateComplexity(
  task: string,
  context: string | undefined,
  subtasks: Subtask[],
): Complexity {
  const risk = countMatches(`${task} ${context ?? ""}`, RISK_KEYWORDS);
  const lowConfidence = subtasks.filter((s) => s.confidence === "low").length;
  let score = 0;
  if (subtasks.length >= 6) score += 2;
  else if (subtasks.length >= 4) score += 1;
  score += Math.min(risk, 3);
  score += lowConfidence;
  score += ambiguityScore(task, context) >= 2 ? 1 : 0;
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

export function buildConfidenceSummary(
  subtasks: Subtask[],
  strategy: ExecutionStrategy,
  complexity: Complexity,
): string {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const s of subtasks) counts[s.confidence]++;
  const overall: Confidence =
    counts.low > counts.high || (counts.low >= 1 && complexity === "high")
      ? "low"
      : counts.high >= counts.medium + counts.low
        ? "high"
        : "medium";
  return (
    `${subtasks.length} subtasks (${counts.high} high, ${counts.medium} medium, ` +
    `${counts.low} low). Overall ${overall} confidence at ${complexity} complexity. ` +
    `Recommended execution strategy: ${strategy}.`
  );
}

// ---------------------------------------------------------------------------
// Heuristic fallback (deterministic, but meaningfully better than the skeleton)
// ---------------------------------------------------------------------------

interface HeuristicStep {
  title: string;
  description: string;
  baseConfidence: Confidence;
}

function heuristicSteps(task: string, context?: string): HeuristicStep[] {
  const label = task.trim().replace(/\.$/, "");
  const ambiguity = ambiguityScore(task, context);
  const risk = countMatches(`${task} ${context ?? ""}`, RISK_KEYWORDS);

  const steps: HeuristicStep[] = [
    {
      title: `Clarify requirements and acceptance criteria for "${label}"`,
      description:
        "Resolve ambiguities, define concrete success metrics, list constraints, and agree on what 'done' means before implementation.",
      baseConfidence: "high",
    },
    {
      title: "Investigate the current implementation and constraints",
      description:
        "Read the relevant code, data models, and integrations; document existing behavior, edge cases, and the surface area impacted by the change.",
      baseConfidence: "high",
    },
    {
      title: "Design the approach and interfaces",
      description:
        "Propose the technical design (APIs, data changes, components), enumerate alternatives and trade-offs, and get the plan reviewed.",
      baseConfidence: "medium",
    },
    {
      title: "Implement the core change",
      description:
        "Build the primary functionality following the agreed design, keeping changes focused and consistent with existing conventions.",
      baseConfidence: "medium",
    },
    {
      title: "Add tests and cover edge cases",
      description:
        "Write unit/integration tests for the happy path and the failure/edge cases uncovered during design; ensure they pass.",
      baseConfidence: "medium",
    },
  ];

  // For complex/risky work, add rollout & documentation as an explicit step.
  if (ambiguity + risk >= 2) {
    steps.push({
      title: "Document, roll out, and add observability",
      description:
        "Update docs, plan a safe rollout (feature flag/staged deploy as needed), and add metrics/logging to confirm the change behaves in production.",
      baseConfidence: "medium",
    });
  }

  return steps;
}

function heuristicSubtasks(task: string, context?: string): Subtask[] {
  const ambiguity = ambiguityScore(task, context);
  const risk = countMatches(`${task} ${context ?? ""}`, RISK_KEYWORDS);
  const steps = heuristicSteps(task, context);

  return steps.map((step, index) => {
    let confidence = step.baseConfidence;
    // Calibrate downward when the task is ambiguous or risky and the step
    // carries the uncertainty (design/implementation), not the scoping steps.
    const isUncertaintyBearing = index >= 2;
    if (isUncertaintyBearing && ambiguity >= 2 && confidence === "medium") {
      confidence = "low";
    }
    if (isUncertaintyBearing && risk >= 3 && confidence === "medium") {
      confidence = "low";
    }
    if (index <= 1 && ambiguity >= 3 && confidence === "high") {
      confidence = "medium";
    }
    return {
      id: `s${index + 1}`,
      title: step.title,
      description: step.description,
      confidence,
      justification: justify(confidence, ambiguity, risk),
      dependsOn: index === 0 ? [] : [`s${index}`],
    };
  });
}

function justify(
  confidence: Confidence,
  ambiguity: number,
  risk: number,
): string {
  if (confidence === "high") {
    return "Well-understood, low-risk work with clear success criteria.";
  }
  if (confidence === "low") {
    return ambiguity >= 2
      ? "Task is underspecified, so this step carries significant unknowns until requirements are pinned down."
      : "High technical risk (migration/security/performance) makes the outcome uncertain.";
  }
  return risk >= 1
    ? "Approach is mostly clear but involves design decisions and non-trivial integration surface."
    : "Mostly clear, with some design decisions to make.";
}

export function heuristicDecomposition(
  task: string,
  context?: string,
): Decomposition {
  const subtasks = heuristicSubtasks(task, context);
  const complexity = estimateComplexity(task, context, subtasks);
  const strategy = deriveExecutionStrategy(subtasks, complexity);
  return {
    subtasks,
    executionStrategy: strategy,
    estimatedComplexity: complexity,
    confidenceSummary: buildConfidenceSummary(subtasks, strategy, complexity),
  };
}
