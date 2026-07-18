// Cost/confidence routing heuristic (PRD §12): suggest which model tier, whether
// to run locally or delegate to cloud managed Devins, and how many can run in
// parallel, based on per-subtask confidence and the estimated complexity.
import type {
  Complexity,
  Confidence,
  Decomposition,
  ModelTier,
  RoutingSuggestion,
  Subtask,
  SubtaskRouting,
} from "./types.js";

const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const COMPLEXITY_SCORE: Record<Complexity, number> = { low: 0, medium: 1, high: 2 };

function routeSubtask(subtask: Subtask, complexity: Complexity): SubtaskRouting {
  const score = CONFIDENCE_SCORE[subtask.confidence] + COMPLEXITY_SCORE[complexity];
  // Higher uncertainty/complexity -> more capable model and closer human oversight.
  const model: ModelTier = score >= 3 ? "advanced" : score >= 1 ? "standard" : "lite";
  // High-confidence, dependency-free work is safe to delegate to a cloud managed
  // Devin; anything less benefits from local, human-in-the-loop iteration.
  const environment =
    subtask.confidence === "high" && subtask.dependsOn.length === 0 ? "cloud" : "local";
  return {
    subtaskId: subtask.id,
    model,
    environment,
    rationale:
      `${subtask.confidence} confidence + ${complexity} complexity -> ${model} model, ` +
      `${environment === "cloud" ? "delegate to a managed Devin" : "run locally with oversight"}.`,
  };
}

export function suggestRouting(
  subtasks: Subtask[],
  complexity: Complexity,
  strategy: Decomposition["executionStrategy"],
): RoutingSuggestion {
  const perSubtask = subtasks.map((s) => routeSubtask(s, complexity));
  const tierRank: Record<ModelTier, number> = { lite: 0, standard: 1, advanced: 2 };
  const recommendedModel = perSubtask.reduce<ModelTier>(
    (best, r) => (tierRank[r.model] > tierRank[best] ? r.model : best),
    "lite",
  );
  const cloudSubtasks = perSubtask.filter((r) => r.environment === "cloud");
  // Only fan out to parallel managed Devins when the strategy allows it.
  const canParallelize = strategy === "parallel" || strategy === "managed-devins";
  const parallelDevins = canParallelize ? Math.max(1, cloudSubtasks.length) : 1;
  const environment = cloudSubtasks.length > 0 ? "cloud" : "local";
  return {
    recommendedModel,
    environment,
    parallelDevins,
    perSubtask,
    rationale:
      `Recommend the ${recommendedModel} model tier; ` +
      (environment === "cloud"
        ? `delegate ${cloudSubtasks.length} high-confidence subtask(s) to ${parallelDevins} parallel managed Devin(s)`
        : "run locally with human oversight due to lower confidence") +
      ` (strategy: ${strategy}).`,
  };
}
