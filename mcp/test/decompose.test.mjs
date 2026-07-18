// Tests for model-backed task decomposition (issue #17).
//
// The TypeScript sources are compiled to `.test-build/` by the `pretest`
// script; these tests import the emitted JS so they run on plain Node without a
// TypeScript loader.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coerceDecomposition,
  decomposeTask,
  deriveExecutionStrategy,
  extractJsonObject,
  heuristicDecomposition,
  normalizeConfidence,
} from "../.test-build/src/decompose.js";

const EXAMPLE_TASKS = [
  "Implement rate limiting for the public API.",
  "Add SSO login to the dashboard.",
  "Migrate the service from REST to GraphQL.",
  "Make the app faster.",
  "Add offline support to the mobile app.",
  "Improve test coverage for the payments module.",
  "Set up observability for the checkout flow.",
];

const CONFIDENCE = new Set(["high", "medium", "low"]);
const STRATEGY = new Set(["parallel", "sequential", "managed-devins"]);
const COMPLEXITY = new Set(["low", "medium", "high"]);

function assertValidDecomposition(d) {
  assert.ok(Array.isArray(d.subtasks), "subtasks is an array");
  assert.ok(
    d.subtasks.length >= 3 && d.subtasks.length <= 7,
    `3-7 subtasks, got ${d.subtasks.length}`,
  );
  assert.ok(STRATEGY.has(d.executionStrategy), "valid executionStrategy");
  assert.ok(COMPLEXITY.has(d.estimatedComplexity), "valid estimatedComplexity");
  assert.ok(
    typeof d.confidenceSummary === "string" && d.confidenceSummary.length > 0,
    "non-empty confidenceSummary",
  );
  const ids = new Set();
  for (const s of d.subtasks) {
    assert.ok(s.id && !ids.has(s.id), `unique id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.title && s.description, "title + description present");
    assert.ok(CONFIDENCE.has(s.confidence), `valid confidence ${s.confidence}`);
    assert.ok(
      s.justification && s.justification.length > 0,
      "justification present",
    );
    assert.ok(Array.isArray(s.dependsOn), "dependsOn is an array");
  }
  // dependsOn references must point at real subtasks (no dangling/self refs).
  for (const s of d.subtasks) {
    for (const dep of s.dependsOn) {
      assert.ok(ids.has(dep), `dependency ${dep} exists`);
      assert.notEqual(dep, s.id, "no self dependency");
    }
  }
}

test("heuristic decomposition honors the contract on every example task", () => {
  for (const task of EXAMPLE_TASKS) {
    const d = heuristicDecomposition(task);
    assertValidDecomposition(d);
  }
});

test("heuristic decomposition is meaningfully richer than the skeleton", () => {
  for (const task of EXAMPLE_TASKS) {
    const d = heuristicDecomposition(task);
    assert.ok(d.subtasks.length >= 5, `>=5 subtasks for "${task}"`);
    assert.ok(
      new Set(d.subtasks.map((s) => s.confidence)).size >= 2,
      "confidence levels are differentiated, not all identical",
    );
    assert.notEqual(
      d.confidenceSummary,
      "Skeleton decomposition; refine with model-backed generation.",
    );
  }
});

test("confidence is calibrated: vague tasks are less confident than concrete ones", () => {
  const vague = heuristicDecomposition("Make the app faster.");
  const concrete = heuristicDecomposition(
    "Add a nullable email column to the users table via a migration.",
  );
  const lowCount = (d) => d.subtasks.filter((s) => s.confidence === "low").length;
  assert.ok(
    lowCount(vague) >= lowCount(concrete),
    "the ambiguous task carries at least as many low-confidence subtasks",
  );
  assert.ok(lowCount(vague) >= 1, "an ambiguous task has low-confidence work");
});

test("execution strategy reflects dependency structure", () => {
  const chain = [
    { id: "s1", title: "a", description: "a", confidence: "high", justification: "j", dependsOn: [] },
    { id: "s2", title: "b", description: "b", confidence: "high", justification: "j", dependsOn: ["s1"] },
    { id: "s3", title: "c", description: "c", confidence: "high", justification: "j", dependsOn: ["s2"] },
  ];
  assert.equal(deriveExecutionStrategy(chain, "medium"), "sequential");

  const independent = [
    { id: "s1", title: "a", description: "a", confidence: "high", justification: "j", dependsOn: [] },
    { id: "s2", title: "b", description: "b", confidence: "high", justification: "j", dependsOn: [] },
    { id: "s3", title: "c", description: "c", confidence: "high", justification: "j", dependsOn: [] },
  ];
  assert.equal(deriveExecutionStrategy(independent, "low"), "parallel");
  assert.equal(deriveExecutionStrategy(independent, "high"), "managed-devins");
});

test("normalizeConfidence maps fuzzy values", () => {
  assert.equal(normalizeConfidence("HIGH"), "high");
  assert.equal(normalizeConfidence("Med"), "medium");
  assert.equal(normalizeConfidence(0.9), "high");
  assert.equal(normalizeConfidence(0.1), "low");
  assert.equal(normalizeConfidence(undefined), "medium");
});

test("extractJsonObject recovers JSON wrapped in prose or code fences", () => {
  const wrapped = 'Sure!\n```json\n{"a": 1, "b": {"c": 2}}\n```\nDone.';
  assert.deepEqual(extractJsonObject(wrapped), { a: 1, b: { c: 2 } });
  assert.equal(extractJsonObject("no json here"), null);
});

test("coerceDecomposition validates and repairs model output", () => {
  const raw = {
    subtasks: [
      { title: "Only one subtask", confidence: "definitely high", dependsOn: ["ghost"] },
    ],
    executionStrategy: "run them together",
    estimatedComplexity: "H",
  };
  const d = coerceDecomposition(raw, "Add SSO login to the dashboard.");
  assertValidDecomposition(d); // padded to >=3, dangling dep dropped, enums fixed
  assert.equal(d.estimatedComplexity, "high"); // "H" -> "high"
  assert.equal(d.subtasks[0].dependsOn.length, 0); // dangling "ghost" dropped
});

test("padding preserves model subtasks' relative dependencies (no id collision)", () => {
  // Two valid model subtasks (s2 depends on s1) get padded with filler that
  // would otherwise reuse ids s1.. and corrupt the dependency remap.
  const raw = {
    subtasks: [
      { id: "s1", title: "First model step", description: "d", confidence: "high", justification: "j", dependsOn: [] },
      { id: "s2", title: "Second model step", description: "d", confidence: "high", justification: "j", dependsOn: ["s1"] },
    ],
  };
  const d = coerceDecomposition(raw, "Make the app faster.");
  assertValidDecomposition(d);
  const first = d.subtasks.find((s) => s.title === "First model step");
  const second = d.subtasks.find((s) => s.title === "Second model step");
  assert.ok(first && second);
  // The second step must still depend on the first step, not a padding step.
  assert.deepEqual(second.dependsOn, [first.id]);
});

test("decomposeTask falls back to heuristic when no AI binding is configured", async () => {
  const d = await decomposeTask({ DB: undefined }, "Add offline support to the mobile app.");
  assertValidDecomposition(d);
});

test("decomposeTask uses the AI binding and coerces its JSON output", async () => {
  const modelJson = JSON.stringify({
    subtasks: [
      { id: "s1", title: "Design token exchange", description: "d", confidence: "medium", justification: "j", dependsOn: [] },
      { id: "s2", title: "Implement callback", description: "d", confidence: "medium", justification: "j", dependsOn: ["s1"] },
      { id: "s3", title: "Add tests", description: "d", confidence: "high", justification: "j", dependsOn: ["s2"] },
    ],
    executionStrategy: "sequential",
    estimatedComplexity: "high",
    confidenceSummary: "model summary",
  });
  const env = {
    DB: undefined,
    AI: { run: async () => ({ response: "```json\n" + modelJson + "\n```" }) },
  };
  const d = await decomposeTask(env, "Add SSO login to the dashboard.");
  assertValidDecomposition(d);
  assert.equal(d.confidenceSummary, "model summary");
  assert.equal(d.subtasks[0].title, "Design token exchange");
});

test("decomposeTask falls back to heuristic when the AI call throws", async () => {
  const env = {
    DB: undefined,
    AI: {
      run: async () => {
        throw new Error("model unavailable");
      },
    },
  };
  const d = await decomposeTask(env, "Migrate the service from REST to GraphQL.");
  assertValidDecomposition(d);
});
