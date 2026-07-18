// Heuristics + artifact generation for promoting high-quality, well-reviewed plans
// into Devin Knowledge or a new Playbook (PRD §12). This module is intentionally
// pure/deterministic so it can be unit-tested and reasoned about; the actual
// creation is performed by the agent through the official Devin MCP using the
// suggested calls this module returns.

import type {
  AdversarialReview,
  KnowledgeArtifact,
  Plan,
  PlaybookArtifact,
  PromotionCheck,
  PromotionResult,
  PromotionTarget,
  QualityAssessment,
  SuggestedMcpCall,
  Subtask,
} from "./types.js";

export const DEFAULT_PROMOTION_THRESHOLD = 80;
export const DEVIN_MCP_SERVER = "https://mcp.devin.ai/mcp";

const CONFIDENCE_WEIGHT: Record<Subtask["confidence"], number> = {
  high: 1,
  medium: 0.5,
  low: 0,
};

export interface AssessInput {
  plan: Plan;
  review?: AdversarialReview;
  reviewIncorporated?: boolean;
  threshold?: number;
}

function isMeaningful(text: string | null | undefined, min: number): boolean {
  return typeof text === "string" && text.trim().length >= min;
}

function looksLikeSkeleton(summary: string): boolean {
  return /skeleton/i.test(summary);
}

/**
 * Evaluate a plan against the "high-quality" heuristics. A plan is promotable
 * only when it clears the score threshold AND every mandatory gate passes
 * (an adversarial review must exist and have been incorporated).
 */
export function assessPlanQuality(input: AssessInput): QualityAssessment {
  const { plan, review, reviewIncorporated } = input;
  const threshold = input.threshold ?? DEFAULT_PROMOTION_THRESHOLD;
  const subtasks = plan.decomposition?.subtasks ?? [];

  const count = subtasks.length;
  const wellScoped = count >= 3 && count <= 7;

  const withJustification = subtasks.filter((s) => isMeaningful(s.justification, 12)).length;
  const allJustified = count > 0 && withJustification === count;

  const avgConfidence =
    count > 0
      ? subtasks.reduce((sum, s) => sum + (CONFIDENCE_WEIGHT[s.confidence] ?? 0), 0) / count
      : 0;
  const lowCount = subtasks.filter((s) => s.confidence === "low").length;
  const highConfidence = count > 0 && avgConfidence >= 0.7 && lowCount === 0;

  const summary = plan.decomposition?.confidenceSummary ?? plan.confidenceSummary ?? "";
  const hasSummary = isMeaningful(summary, 20) && !looksLikeSkeleton(summary);

  const reviewPresent = Boolean(
    review &&
      ((review.weakAssumptions?.length ?? 0) > 0 ||
        (review.missingEdgeCases?.length ?? 0) > 0 ||
        (review.risks?.length ?? 0) > 0 ||
        (review.recommendedChanges?.length ?? 0) > 0),
  );
  const incorporated = reviewIncorporated === true;

  const highRisks = review?.risks?.filter((r) => (r.score ?? 0) >= 4) ?? [];
  const risksAddressed = highRisks.length === 0 || incorporated;

  const checks: PromotionCheck[] = [
    {
      id: "well_scoped",
      label: "3–7 concrete subtasks",
      passed: wellScoped,
      mandatory: false,
      weight: 15,
      detail: `${count} subtask(s)`,
    },
    {
      id: "justified",
      label: "Every subtask has a substantive justification",
      passed: allJustified,
      mandatory: false,
      weight: 15,
      detail: `${withJustification}/${count} justified`,
    },
    {
      id: "high_confidence",
      label: "High overall confidence with no low-confidence subtasks",
      passed: highConfidence,
      mandatory: false,
      weight: 25,
      detail: `avg confidence ${avgConfidence.toFixed(2)}, ${lowCount} low`,
    },
    {
      id: "confidence_summary",
      label: "Meaningful confidence summary (not a skeleton)",
      passed: hasSummary,
      mandatory: false,
      weight: 10,
      detail: hasSummary ? "present" : "missing or skeleton",
    },
    {
      id: "review_present",
      label: "Adversarial review was run",
      passed: reviewPresent,
      mandatory: true,
      weight: 15,
      detail: reviewPresent ? "review provided" : "no review provided",
    },
    {
      id: "review_incorporated",
      label: "Adversarial findings were incorporated",
      passed: incorporated,
      mandatory: true,
      weight: 15,
      detail: incorporated ? "incorporated" : "not marked as incorporated",
    },
    {
      id: "risks_addressed",
      label: "No unaddressed high-severity risks",
      passed: risksAddressed,
      mandatory: false,
      weight: 5,
      detail: `${highRisks.length} high-severity risk(s)`,
    },
  ];

  const score = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const mandatoryPassed = checks.filter((c) => c.mandatory).every((c) => c.passed);
  const eligible = mandatoryPassed && score >= threshold;

  const reasons = checks.filter((c) => c.passed).map((c) => `${c.label} (${c.detail})`);
  const failures: string[] = checks
    .filter((c) => !c.passed)
    .map((c) => `${c.label} — ${c.detail}${c.mandatory ? " [required]" : ""}`);
  if (!eligible && mandatoryPassed && score < threshold) {
    failures.push(`Quality score ${score} is below the ${threshold} promotion threshold`);
  }

  return { eligible, score, threshold, checks, reasons, failures };
}

const STOPWORDS = new Set([
  "the", "a", "an", "for", "and", "or", "to", "of", "in", "on", "with", "into",
  "implement", "add", "create", "build", "task", "this", "that", "our", "your",
]);

function deriveTags(task: string): string[] {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, 5);
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "plan"
  );
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function subtaskLines(subtasks: Subtask[]): string {
  return subtasks
    .map((s, i) => `${i + 1}. **${s.title}** — _${s.confidence} confidence_. ${s.description}`)
    .join("\n");
}

function reviewLines(review?: AdversarialReview): string {
  if (!review) return "_No adversarial review recorded._";
  const parts: string[] = [];
  if (review.weakAssumptions?.length) {
    parts.push(
      `- Weak assumptions: ${review.weakAssumptions.map((w) => w.description).join("; ")}`,
    );
  }
  if (review.missingEdgeCases?.length) {
    parts.push(
      `- Edge cases covered: ${review.missingEdgeCases.map((e) => e.description).join("; ")}`,
    );
  }
  if (review.risks?.length) {
    parts.push(
      `- Risks: ${review.risks.map((r) => `${r.description} (severity ${r.score})`).join("; ")}`,
    );
  }
  if (review.recommendedChanges?.length) {
    parts.push(`- Changes applied: ${review.recommendedChanges.join("; ")}`);
  }
  return parts.length ? parts.join("\n") : "_Adversarial review produced no findings._";
}

export function buildKnowledgeArtifact(plan: Plan, review?: AdversarialReview): KnowledgeArtifact {
  const d = plan.decomposition;
  const title = truncate(plan.originalTask, 70);
  const body = [
    `# Proven plan: ${title}`,
    "",
    "This plan was decomposed, adversarially reviewed, and promoted by devin-scope. Reuse it as a",
    "starting point for similar tasks; re-run the adversarial review before executing.",
    "",
    `**Original task:** ${plan.originalTask}`,
    `**Execution strategy:** ${d.executionStrategy}`,
    `**Estimated complexity:** ${d.estimatedComplexity}`,
    "",
    "## Subtasks",
    subtaskLines(d.subtasks),
    "",
    "## Adversarial review summary",
    reviewLines(review),
    "",
    "## Confidence",
    d.confidenceSummary || plan.confidenceSummary || "See per-subtask confidence above.",
  ].join("\n");

  return {
    name: `devin-scope plan: ${title}`,
    triggerDescription: `When scoping or planning a task similar to: ${truncate(plan.originalTask, 120)}`,
    tags: Array.from(new Set(["devin-scope", "promoted-plan", ...deriveTags(plan.originalTask)])),
    body,
  };
}

export function buildPlaybookArtifact(plan: Plan, review?: AdversarialReview): PlaybookArtifact {
  const d = plan.decomposition;
  const title = truncate(plan.originalTask, 70);
  const slug = `devin-scope-${slugify(plan.originalTask)}`;
  const content = [
    `# Playbook: ${title}`,
    "",
    "A reusable, devin-scope-vetted plan for tasks like this one. Follow it in order, and re-run",
    "`run_adversarial_review` against your adapted plan before executing.",
    "",
    `Recommended execution strategy: **${d.executionStrategy}** (estimated complexity: ${d.estimatedComplexity}).`,
    "",
    "## Steps",
    subtaskLines(d.subtasks),
    "",
    "## Guardrails from adversarial review",
    reviewLines(review),
    "",
    "## Before you finish",
    "Call `get_verification_checklist` and satisfy every item before proposing a PR.",
  ].join("\n");

  return { name: `devin-scope: ${title}`, slug, content };
}

function suggestKnowledgeCall(artifact: KnowledgeArtifact): SuggestedMcpCall {
  return {
    server: DEVIN_MCP_SERVER,
    tool: "devin_knowledge_manage",
    description: "Create a Knowledge note from the promoted plan via the official Devin MCP.",
    arguments: {
      action: "create",
      name: artifact.name,
      body: artifact.body,
      trigger_description: artifact.triggerDescription,
      tags: artifact.tags,
    },
  };
}

function suggestPlaybookCall(artifact: PlaybookArtifact): SuggestedMcpCall {
  return {
    server: DEVIN_MCP_SERVER,
    tool: "devin_playbook_manage",
    description: "Create a new Playbook from the promoted plan via the official Devin MCP.",
    arguments: {
      action: "create",
      name: artifact.name,
      slug: artifact.slug,
      content: artifact.content,
    },
  };
}

export interface PromoteInput extends AssessInput {
  target?: PromotionTarget;
}

/**
 * Assess a plan and, when it qualifies, produce the promotion artifact(s) plus
 * the suggested official-Devin-MCP calls the agent should run to persist them.
 */
export function promotePlan(input: PromoteInput): PromotionResult {
  const assessment = assessPlanQuality(input);
  const target = input.target ?? null;

  const flow: string[] = [
    "1. Run the full devin-scope pipeline (decompose → save_plan → run_adversarial_review → incorporate).",
    "2. Call promote_plan with the plan_id, the adversarial review, and review_incorporated=true.",
    "3. If eligible, review the generated artifact(s) below.",
    "4. Persist them with the suggested official Devin MCP calls (devin_knowledge_manage / devin_playbook_manage).",
    "5. Confirm creation and reuse the Knowledge/Playbook on future similar tasks.",
  ];

  if (!assessment.eligible) {
    return { assessment, target, suggestedMcpCalls: [], flow };
  }

  const result: PromotionResult = { assessment, target, suggestedMcpCalls: [], flow };
  const effectiveTarget: PromotionTarget = target ?? "knowledge";

  if (effectiveTarget === "knowledge") {
    result.knowledge = buildKnowledgeArtifact(input.plan, input.review);
    result.suggestedMcpCalls.push(suggestKnowledgeCall(result.knowledge));
  } else {
    result.playbook = buildPlaybookArtifact(input.plan, input.review);
    result.suggestedMcpCalls.push(suggestPlaybookCall(result.playbook));
  }
  result.target = effectiveTarget;

  return result;
}
