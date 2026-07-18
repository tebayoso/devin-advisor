import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_PROMOTION_THRESHOLD,
  assessPlanQuality,
  buildKnowledgeArtifact,
  buildPlaybookArtifact,
  promotePlan,
} from "../src/promotion.ts";
import type { AdversarialReview, Plan, Subtask } from "../src/types.ts";

function subtask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    id: "s1",
    title: "Do a well-defined thing",
    description: "A concrete, actionable subtask.",
    confidence: "high",
    justification: "This step is well understood and low risk.",
    dependsOn: [],
    ...overrides,
  };
}

function goodPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    workspace: null,
    originalTask: "Implement rate limiting for the public API",
    decomposition: {
      subtasks: [
        subtask({ id: "s1", title: "Define limits and buckets" }),
        subtask({ id: "s2", title: "Add middleware", confidence: "high" }),
        subtask({ id: "s3", title: "Add tests and metrics", confidence: "medium" }),
      ],
      executionStrategy: "sequential",
      estimatedComplexity: "medium",
      confidenceSummary: "Requirements are clear and each subtask has a well-scoped path.",
    },
    confidenceSummary: "Requirements are clear and each subtask has a well-scoped path.",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const goodReview: AdversarialReview = {
  weakAssumptions: [
    { category: "requirements", description: "Traffic patterns are uniform", relatedSubtasks: [] },
  ],
  missingEdgeCases: [
    { category: "concurrency", description: "Burst traffic", relatedSubtasks: [] },
    { category: "data-integrity", description: "Distributed counters", relatedSubtasks: [] },
  ],
  risks: [
    {
      description: "Counter drift across edges",
      category: "data-integrity",
      likelihood: "medium",
      impact: "high",
      score: 6,
      severity: "high",
      explanation: "Edge-local counters can diverge without a shared store.",
      relatedSubtasks: [],
    },
  ],
  recommendedChanges: ["Use a shared store for counters"],
  historicalInsights: [],
  riskSummary: {
    riskCount: 1,
    overallScore: 6,
    highestSeverity: "high",
    scoringModel: "likelihood(1-3) x impact(1-3)",
  },
  confidenceAdjustment: "Confidence holds after adding a shared store subtask.",
};

test("well-reviewed high-quality plan is eligible", () => {
  const a = assessPlanQuality({ plan: goodPlan(), review: goodReview, reviewIncorporated: true });
  assert.equal(a.eligible, true);
  assert.ok(a.score >= a.threshold);
  assert.equal(a.threshold, DEFAULT_PROMOTION_THRESHOLD);
});

test("missing review blocks promotion even with a strong plan", () => {
  const a = assessPlanQuality({ plan: goodPlan(), reviewIncorporated: true });
  assert.equal(a.eligible, false);
  assert.ok(a.failures.some((f) => /review/i.test(f)));
});

test("review present but not incorporated is ineligible", () => {
  const a = assessPlanQuality({ plan: goodPlan(), review: goodReview, reviewIncorporated: false });
  assert.equal(a.eligible, false);
});

test("low-confidence subtasks disqualify the plan", () => {
  const plan = goodPlan();
  plan.decomposition.subtasks[2] = subtask({ id: "s3", confidence: "low" });
  const a = assessPlanQuality({ plan, review: goodReview, reviewIncorporated: true });
  assert.equal(a.checks.find((c) => c.id === "high_confidence")?.passed, false);
});

test("skeleton confidence summary fails the summary check", () => {
  const plan = goodPlan({ confidenceSummary: "Skeleton decomposition; refine later." });
  plan.decomposition.confidenceSummary = "Skeleton decomposition; refine later.";
  const a = assessPlanQuality({ plan, review: goodReview, reviewIncorporated: true });
  assert.equal(a.checks.find((c) => c.id === "confidence_summary")?.passed, false);
});

test("unaddressed high-severity risk is flagged when not incorporated", () => {
  const review: AdversarialReview = {
    ...goodReview,
    risks: [
      {
        description: "Data loss",
        category: "data-integrity",
        likelihood: "high",
        impact: "high",
        score: 9,
        severity: "critical",
        explanation: "Unbounded writes can drop data under load.",
        relatedSubtasks: [],
      },
    ],
  };
  const a = assessPlanQuality({ plan: goodPlan(), review, reviewIncorporated: false });
  assert.equal(a.checks.find((c) => c.id === "risks_addressed")?.passed, false);
});

test("promotePlan returns a knowledge artifact by default when eligible", () => {
  const r = promotePlan({ plan: goodPlan(), review: goodReview, reviewIncorporated: true });
  assert.equal(r.assessment.eligible, true);
  assert.equal(r.target, "knowledge");
  assert.ok(r.knowledge);
  assert.equal(r.suggestedMcpCalls[0]?.tool, "devin_knowledge_manage");
  assert.ok(r.knowledge!.tags.includes("promoted-plan"));
  assert.ok(r.knowledge!.body.includes("rate limiting"));
});

test("promotePlan can target a playbook", () => {
  const r = promotePlan({
    plan: goodPlan(),
    review: goodReview,
    reviewIncorporated: true,
    target: "playbook",
  });
  assert.equal(r.target, "playbook");
  assert.ok(r.playbook);
  assert.equal(r.suggestedMcpCalls[0]?.tool, "devin_playbook_manage");
  assert.ok(r.playbook!.slug.startsWith("devin-scope-"));
});

test("ineligible plan yields no artifacts or calls but keeps the documented flow", () => {
  const r = promotePlan({ plan: goodPlan(), reviewIncorporated: false });
  assert.equal(r.assessment.eligible, false);
  assert.equal(r.suggestedMcpCalls.length, 0);
  assert.equal(r.knowledge, undefined);
  assert.ok(r.flow.length > 0);
});

test("artifact builders are deterministic and well-formed", () => {
  const k = buildKnowledgeArtifact(goodPlan(), goodReview);
  assert.ok(k.name.startsWith("devin-scope plan:"));
  assert.ok(k.triggerDescription.length > 0);
  // Review items are structured objects; the artifact must render their
  // descriptions, never "[object Object]".
  assert.ok(k.body.includes("Traffic patterns are uniform"));
  assert.ok(k.body.includes("Burst traffic"));
  assert.ok(!k.body.includes("[object Object]"));
  const p = buildPlaybookArtifact(goodPlan(), goodReview);
  assert.ok(p.content.includes("## Steps"));
});
