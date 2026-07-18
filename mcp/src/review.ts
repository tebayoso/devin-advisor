// Deterministic, heuristic adversarial-review engine for devin-scope.
//
// Model-backed generation is a later roadmap item; this module derives a
// consistent, explainable critique from the plan's structure plus any relevant
// historical memory. The scoring model is fixed so identical plans always
// produce identical risk scores (see SCORING_MODEL).

import type {
  AdversarialReview,
  CategorizedItem,
  Confidence,
  CritiqueCategory,
  Decomposition,
  MemoryEntry,
  RiskLevel,
  RiskSeverity,
  ScoredRisk,
} from "./types.js";

export const SCORING_MODEL =
  "score = likelihood(low=1,medium=2,high=3) x impact(low=1,medium=2,high=3), " +
  "range 1-9. severity: 1-2 low, 3-4 medium, 5-6 high, 8-9 critical.";

const LEVEL_VALUE: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

export function riskScore(likelihood: RiskLevel, impact: RiskLevel): number {
  return LEVEL_VALUE[likelihood] * LEVEL_VALUE[impact];
}

export function severityFromScore(score: number): RiskSeverity {
  if (score <= 2) return "low";
  if (score <= 4) return "medium";
  if (score <= 6) return "high";
  return "critical";
}

function makeRisk(
  description: string,
  category: CritiqueCategory,
  likelihood: RiskLevel,
  impact: RiskLevel,
  explanation: string,
  relatedSubtasks: string[] = [],
): ScoredRisk {
  const score = riskScore(likelihood, impact);
  return {
    description,
    category,
    likelihood,
    impact,
    score,
    severity: severityFromScore(score),
    explanation,
    relatedSubtasks,
  };
}

// Keyword -> categories the plan text implies we must actively review.
const KEYWORD_CATEGORIES: { pattern: RegExp; categories: CritiqueCategory[] }[] = [
  { pattern: /auth|login|permission|token|secret|credential|password|oauth/, categories: ["security"] },
  { pattern: /delete|remove|drop|destroy|purge|truncate/, categories: ["data-integrity", "rollback"] },
  { pattern: /migrat|schema|database|\bsql\b|\bd1\b|table/, categories: ["data-integrity"] },
  { pattern: /api|endpoint|request|http|fetch|webhook|third-?party/, categories: ["integration", "error-handling"] },
  { pattern: /concurren|parallel|race|async|queue|lock|worker/, categories: ["concurrency"] },
  { pattern: /perf|scale|large|load|latency|throughput|memory|timeout/, categories: ["performance"] },
  { pattern: /file|upload|input|parse|validate|payload|form|user-?provided/, categories: ["input-validation"] },
  { pattern: /deploy|release|rollout|revert|rollback/, categories: ["rollback"] },
];

const CATEGORY_EDGE_CASES: Partial<Record<CritiqueCategory, string>> = {
  security: "Authentication/authorization bypass and handling of missing or malformed credentials.",
  "data-integrity": "Partial writes and consistency if the operation fails midway.",
  rollback: "No clean rollback/undo path if the change must be reverted.",
  integration: "Downstream/third-party service is slow, unavailable, or returns unexpected shapes.",
  concurrency: "Concurrent invocations racing on shared state or ordering assumptions.",
  performance: "Behavior under large inputs or high load (timeouts, resource exhaustion).",
  "input-validation": "Empty, oversized, malformed, or malicious inputs.",
  "error-handling": "Non-happy-path errors surfaced clearly instead of being swallowed.",
  observability: "Failures are observable (logging/metrics) for debugging in production.",
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "them",
  "then", "than", "when", "what", "which", "will", "should", "would", "could",
  "task", "tasks", "plan", "using", "make", "need", "needs", "have", "must",
  "about", "over", "under", "across", "their", "these", "those", "some",
]);

export function extractKeywords(text: string, limit = 6): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length <= 4 || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    words.push(raw);
    if (words.length >= limit) break;
  }
  return words;
}

function planText(originalTask: string, d: Decomposition): string {
  return [
    originalTask,
    ...d.subtasks.map((s) => `${s.title} ${s.description}`),
  ]
    .join(" ")
    .toLowerCase();
}

function impactFromComplexity(c: Decomposition["estimatedComplexity"]): RiskLevel {
  return c === "high" ? "high" : c === "low" ? "low" : "medium";
}

function likelihoodFromConfidence(c: Confidence): RiskLevel {
  return c === "low" ? "high" : c === "medium" ? "medium" : "low";
}

function dedupeRisks(risks: ScoredRisk[]): ScoredRisk[] {
  const byCategory = new Map<CritiqueCategory, ScoredRisk>();
  for (const r of risks) {
    const existing = byCategory.get(r.category);
    if (!existing || r.score > existing.score) byCategory.set(r.category, r);
  }
  return [...byCategory.values()].sort((a, b) => b.score - a.score);
}

/**
 * Build a structured adversarial review from a plan and any relevant historical
 * memory. Pure and deterministic: no I/O, no randomness.
 */
export function buildAdversarialReview(
  originalTask: string,
  decomposition: Decomposition,
  memory: MemoryEntry[] = [],
): AdversarialReview {
  const subtasks = decomposition.subtasks ?? [];
  const text = planText(originalTask, decomposition);
  const complexityImpact = impactFromComplexity(decomposition.estimatedComplexity);

  const impliedCategories = new Set<CritiqueCategory>();
  for (const { pattern, categories } of KEYWORD_CATEGORIES) {
    if (pattern.test(text)) for (const c of categories) impliedCategories.add(c);
  }
  // Baseline categories every plan should be reviewed against.
  impliedCategories.add("error-handling");
  impliedCategories.add("input-validation");
  impliedCategories.add("observability");

  const weakAssumptions: CategorizedItem[] = [];
  const missingEdgeCases: CategorizedItem[] = [];
  const risks: ScoredRisk[] = [];
  const recommendedChanges: string[] = [];

  // --- Weak assumptions ------------------------------------------------------
  const lowConfidence = subtasks.filter(
    (s) => s.confidence === "low" || s.confidence === "medium",
  );
  if (lowConfidence.length > 0) {
    weakAssumptions.push({
      category: "requirements",
      description:
        "Requirements are assumed clear for subtasks that were only rated low/medium confidence.",
      relatedSubtasks: lowConfidence.map((s) => s.id),
    });
  }
  if (subtasks.length <= 1) {
    weakAssumptions.push({
      category: "scope",
      description:
        "The task is assumed simple enough to need little decomposition; hidden scope may be missing.",
      relatedSubtasks: subtasks.map((s) => s.id),
    });
  }
  const withDeps = subtasks.filter((s) => (s.dependsOn ?? []).length > 0);
  if (withDeps.length > 0) {
    weakAssumptions.push({
      category: "dependencies",
      description:
        "Declared subtask dependencies are assumed stable and correctly ordered.",
      relatedSubtasks: withDeps.map((s) => s.id),
    });
  }
  weakAssumptions.push({
    category: "requirements",
    description:
      "Acceptance criteria are assumed to be fully captured; verify explicit, testable criteria exist.",
    relatedSubtasks: [],
  });

  // --- Missing edge cases (from implied categories) --------------------------
  for (const category of impliedCategories) {
    const description = CATEGORY_EDGE_CASES[category];
    if (description) missingEdgeCases.push({ category, description, relatedSubtasks: [] });
  }

  // --- Risks -----------------------------------------------------------------
  for (const s of lowConfidence) {
    risks.push(
      makeRisk(
        `Low confidence on "${s.title}" may hide unresolved requirements.`,
        "requirements",
        likelihoodFromConfidence(s.confidence),
        complexityImpact,
        `Subtask ${s.id} was rated ${s.confidence} confidence; underspecified work is a common source of rework.`,
        [s.id],
      ),
    );
  }

  const parallelWithDeps =
    decomposition.executionStrategy === "parallel" && withDeps.length > 0;
  if (parallelWithDeps) {
    risks.push(
      makeRisk(
        "Parallel execution strategy conflicts with declared subtask dependencies.",
        "concurrency",
        "high",
        "medium",
        "Dependent subtasks run in parallel can execute out of order and corrupt shared state.",
        withDeps.map((s) => s.id),
      ),
    );
  }

  if (impliedCategories.has("security")) {
    risks.push(
      makeRisk(
        "Security-sensitive work (auth/secrets) with no explicit hardening subtask.",
        "security",
        "medium",
        "high",
        "Auth/credential handling has a high blast radius; mistakes leak access or data.",
      ),
    );
  }
  if (impliedCategories.has("data-integrity")) {
    risks.push(
      makeRisk(
        "Destructive or schema-changing operations risk irreversible data loss.",
        "data-integrity",
        "medium",
        "high",
        "Deletes/migrations without backups or transactions can permanently corrupt data.",
      ),
    );
  }
  if (decomposition.estimatedComplexity === "high") {
    risks.push(
      makeRisk(
        "High estimated complexity increases the chance of integration surprises.",
        "scope",
        "high",
        "medium",
        "Complex plans have more interacting parts and are harder to fully specify up front.",
      ),
    );
  }

  const scoredRisks = dedupeRisks(risks);

  // --- Historical insights from memory --------------------------------------
  const historicalInsights: string[] = [];
  for (const entry of memory.slice(0, 5)) {
    const tags = entry.tags.length ? ` [${entry.tags.join(", ")}]` : "";
    historicalInsights.push(`Past learning "${entry.key}"${tags}: ${entry.value}`);
    recommendedChanges.push(
      `Apply prior learning "${entry.key}" from memory before implementing.`,
    );
  }

  // --- Recommended changes ---------------------------------------------------
  for (const ec of missingEdgeCases) {
    recommendedChanges.push(
      `Add a subtask or acceptance check covering ${ec.category}: ${ec.description}`,
    );
  }
  if (lowConfidence.length > 0) {
    recommendedChanges.push(
      "Split or clarify low/medium-confidence subtasks until they can be rated high confidence.",
    );
  }
  if (parallelWithDeps) {
    recommendedChanges.push(
      "Switch dependent subtasks to a sequential (or managed-devins) strategy that respects ordering.",
    );
  }

  // --- Risk summary & confidence adjustment ---------------------------------
  const overallScore = scoredRisks.length
    ? Math.round(
        (scoredRisks.reduce((sum, r) => sum + r.score, 0) / scoredRisks.length) * 10,
      ) / 10
    : 0;
  const highestSeverity = scoredRisks.reduce<RiskSeverity>(
    (max, r) => (severityRank(r.severity) > severityRank(max) ? r.severity : max),
    "low",
  );

  const confidenceAdjustment = confidenceAdjustmentFor(highestSeverity, overallScore);

  return {
    weakAssumptions,
    missingEdgeCases,
    risks: scoredRisks,
    recommendedChanges,
    historicalInsights,
    riskSummary: {
      riskCount: scoredRisks.length,
      overallScore,
      highestSeverity,
      scoringModel: SCORING_MODEL,
    },
    confidenceAdjustment,
  };
}

const SEVERITY_ORDER: RiskSeverity[] = ["low", "medium", "high", "critical"];

function severityRank(s: RiskSeverity): number {
  return SEVERITY_ORDER.indexOf(s);
}

function confidenceAdjustmentFor(
  highestSeverity: RiskSeverity,
  overallScore: number,
): string {
  switch (highestSeverity) {
    case "critical":
      return `Significantly lower overall confidence (avg risk ${overallScore}/9, critical risk present); resolve critical risks before execution.`;
    case "high":
      return `Lower overall confidence (avg risk ${overallScore}/9, high-severity risk present); address high risks and re-review.`;
    case "medium":
      return `Modestly lower overall confidence (avg risk ${overallScore}/9); mitigate medium risks where cheap.`;
    default:
      return `Confidence largely intact (avg risk ${overallScore}/9); proceed while tracking the noted edge cases.`;
  }
}
