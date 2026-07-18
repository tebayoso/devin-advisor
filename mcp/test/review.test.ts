import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAdversarialReview,
  extractKeywords,
  rankMemoryByRelevance,
  riskScore,
  severityFromScore,
  stem,
  tokensMatch,
} from "../src/review.ts";
import type { Decomposition, MemoryEntry } from "../src/types.ts";

function plan(overrides: Partial<Decomposition> = {}): Decomposition {
  return {
    subtasks: [
      {
        id: "s1",
        title: "Implement feature",
        description: "Do the work",
        confidence: "high",
        justification: "clear",
        dependsOn: [],
      },
    ],
    executionStrategy: "sequential",
    estimatedComplexity: "medium",
    confidenceSummary: "ok",
    ...overrides,
  };
}

test("risk scoring model is the fixed likelihood x impact product", () => {
  assert.equal(riskScore("low", "low"), 1);
  assert.equal(riskScore("high", "high"), 9);
  assert.equal(riskScore("medium", "high"), 6);
});

test("severity thresholds are consistent", () => {
  assert.equal(severityFromScore(1), "low");
  assert.equal(severityFromScore(2), "low");
  assert.equal(severityFromScore(4), "medium");
  assert.equal(severityFromScore(6), "high");
  assert.equal(severityFromScore(9), "critical");
});

test("reviews are deterministic (same plan -> same scores)", () => {
  const a = buildAdversarialReview("Build an API", plan());
  const b = buildAdversarialReview("Build an API", plan());
  assert.deepEqual(a, b);
});

test("produces categorized, actionable critiques", () => {
  const review = buildAdversarialReview("Add a login endpoint", plan());
  assert.ok(review.weakAssumptions.length >= 1);
  assert.ok(review.missingEdgeCases.length >= 3);
  assert.ok(review.recommendedChanges.length >= 3);
  // Every item is categorized.
  for (const item of [...review.weakAssumptions, ...review.missingEdgeCases]) {
    assert.equal(typeof item.category, "string");
    assert.ok(item.description.length > 0);
  }
  for (const risk of review.risks) {
    assert.ok(risk.score >= 1 && risk.score <= 9);
    assert.equal(risk.score, riskScore(risk.likelihood, risk.impact));
    assert.equal(risk.severity, severityFromScore(risk.score));
    assert.ok(risk.explanation.length > 0);
  }
});

test("security keywords raise a security risk and edge case", () => {
  const review = buildAdversarialReview("Add oauth token auth", plan());
  assert.ok(review.risks.some((r) => r.category === "security"));
  assert.ok(review.missingEdgeCases.some((e) => e.category === "security"));
});

test("parallel strategy with dependencies is flagged as a concurrency risk", () => {
  const review = buildAdversarialReview(
    "Ship it",
    plan({
      executionStrategy: "parallel",
      subtasks: [
        { id: "s1", title: "A", description: "", confidence: "high", justification: "", dependsOn: [] },
        { id: "s2", title: "B", description: "", confidence: "high", justification: "", dependsOn: ["s1"] },
      ],
    }),
  );
  assert.ok(review.risks.some((r) => r.category === "concurrency"));
});

test("low-confidence subtasks increase risk and lower confidence", () => {
  const review = buildAdversarialReview(
    "Fuzzy task",
    plan({
      subtasks: [
        { id: "s1", title: "Unclear", description: "", confidence: "low", justification: "", dependsOn: [] },
      ],
      estimatedComplexity: "high",
    }),
  );
  const req = review.risks.find((r) => r.category === "requirements");
  assert.ok(req);
  assert.equal(req?.likelihood, "high");
  assert.notEqual(review.riskSummary.highestSeverity, "low");
});

test("historical memory is folded into insights and recommendations", () => {
  const memory: MemoryEntry[] = [
    {
      id: "m1",
      workspace: null,
      key: "auth-timeouts",
      value: "Past auth work broke on token refresh timeouts.",
      tags: ["risk", "auth"],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  ];
  const review = buildAdversarialReview("Add auth", plan(), memory);
  assert.ok(review.historicalInsights.some((i) => i.includes("auth-timeouts")));
  assert.ok(review.recommendedChanges.some((c) => c.includes("auth-timeouts")));
});

test("risk summary reports the scoring model and aggregate score", () => {
  const review = buildAdversarialReview("Delete all rows and migrate schema", plan());
  assert.ok(review.riskSummary.scoringModel.includes("likelihood"));
  assert.equal(review.riskSummary.riskCount, review.risks.length);
  assert.ok(review.riskSummary.overallScore > 0);
});

const mem = (over: Partial<MemoryEntry> & { id: string }): MemoryEntry => ({
  workspace: null,
  key: "",
  value: "",
  tags: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  ...over,
});

test("stem collapses common plural/verb suffixes", () => {
  assert.equal(stem("sessions"), "session");
  assert.equal(stem("deleting"), "delet");
  assert.equal(stem("migrations"), "migration");
  assert.equal(stem("auth"), "auth");
});

test("tokensMatch is stem- and substring-aware (bidirectional)", () => {
  assert.ok(tokensMatch("oauth", "auth"));
  assert.ok(tokensMatch("auth", "oauth"));
  assert.ok(tokensMatch("sessions", "session"));
  assert.ok(!tokensMatch("oauth", "cache"));
  assert.ok(!tokensMatch("api", "cli")); // too short to substring-match
});

test("rankMemoryByRelevance surfaces auth history for an oauth task", () => {
  const entries: MemoryEntry[] = [
    mem({ id: "m1", key: "auth-timeouts", value: "token refresh failures", tags: ["auth"] }),
    mem({ id: "m2", key: "unrelated", value: "styling tweaks", tags: ["ui"] }),
  ];
  const ranked = rankMemoryByRelevance(entries, "Add an OAuth login endpoint");
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "m1");
});

test("rankMemoryByRelevance ranks by match count and is deterministic", () => {
  const entries: MemoryEntry[] = [
    mem({ id: "b", key: "auth", value: "generic auth note" }),
    mem({ id: "a", key: "auth-sessions", value: "auth session refresh" }),
  ];
  const ranked = rankMemoryByRelevance(entries, "Fix auth session refresh");
  assert.deepEqual(ranked.map((e) => e.id), ["a", "b"]);
});

test("extractKeywords drops stopwords and short tokens", () => {
  const kws = extractKeywords("Build the authentication service with tokens");
  assert.ok(kws.includes("authentication"));
  assert.ok(kws.includes("tokens"));
  assert.ok(!kws.includes("the"));
  assert.ok(!kws.includes("with"));
});
