import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCriticPrompt,
  devinApiConfigured,
  parseAdversarialReview,
  runCriticSession,
} from "../src/devin.ts";
import { callTool } from "../src/tools.ts";
import type { Env, Plan } from "../src/types.ts";

const plan: Plan = {
  id: "plan-1",
  workspace: null,
  originalTask: "Add rate limiting to the public API",
  decomposition: {
    subtasks: [
      {
        id: "s1",
        title: "Design limiter",
        description: "Choose algorithm",
        confidence: "medium",
        justification: "Trade-offs exist",
        dependsOn: [],
      },
    ],
    executionStrategy: "sequential",
    estimatedComplexity: "medium",
    confidenceSummary: "ok",
  },
  confidenceSummary: "ok",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const noopDb = {} as Env["DB"];

// D1 stub: getPlan (FROM plans) returns the fixture row; queryMemory (FROM
// memory) returns no history; inserts are no-ops. Enough to exercise the full
// run_adversarial_review path (getPlan -> relevantMemory -> insertReview).
const fakeDb = {
  prepare(sql: string) {
    return {
      bind() {
        return {
          first() {
            if (sql.includes("FROM plans")) {
              return Promise.resolve({
                id: plan.id,
                workspace: plan.workspace,
                original_task: plan.originalTask,
                decomposition: JSON.stringify(plan.decomposition),
                confidence_summary: plan.confidenceSummary,
                created_at: plan.createdAt,
              });
            }
            return Promise.resolve(null);
          },
          all() {
            return Promise.resolve({ results: [] });
          },
          run() {
            return Promise.resolve({});
          },
        };
      },
    };
  },
} as unknown as Env["DB"];

test("devinApiConfigured reflects presence of a non-empty key", () => {
  assert.equal(devinApiConfigured({ DB: noopDb }), false);
  assert.equal(devinApiConfigured({ DB: noopDb, DEVIN_API_KEY: "  " }), false);
  assert.equal(devinApiConfigured({ DB: noopDb, DEVIN_API_KEY: "k" }), true);
});

test("buildCriticPrompt includes the task, decomposition, and structured-output request", () => {
  const prompt = buildCriticPrompt("My task", plan);
  assert.match(prompt, /My task/);
  assert.match(prompt, /Design limiter/);
  assert.match(prompt, /provide_structured_output/);
});

test("parseAdversarialReview normalizes to the rich schema and rejects empty output", () => {
  const review = parseAdversarialReview({
    weakAssumptions: ["a", 1],
    risks: [{ description: "r" }, "plain"],
    recommendedChanges: ["c"],
  });
  assert.deepEqual(review.weakAssumptions, [
    { category: "requirements", description: "a", relatedSubtasks: [] },
  ]);
  assert.equal(review.risks.length, 2);
  assert.equal(review.risks[0].description, "r");
  assert.equal(review.risks[0].score, 4); // medium x medium
  assert.equal(review.risks[0].severity, "medium");
  assert.equal(review.missingEdgeCases.length, 0);
  assert.equal(review.riskSummary.riskCount, 2);

  assert.throws(() => parseAdversarialReview(null));
  assert.throws(() =>
    parseAdversarialReview({ weakAssumptions: [], risks: [], recommendedChanges: [] }),
  );
});

function stubFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) return Promise.resolve(handler());
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("runCriticSession creates a session, polls, and returns a critic-session review", async () => {
  const original = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = stubFetch({
    "/sessions": () =>
      Response.json({ session_id: "sess-1", url: "https://app.devin.ai/sessions/sess-1" }),
    "/session/sess-1": () => {
      polls += 1;
      if (polls < 2) return Response.json({ status_enum: "running" });
      return Response.json({
        status_enum: "blocked",
        structured_output: {
          weakAssumptions: ["assumes single region"],
          missingEdgeCases: ["burst traffic"],
          risks: [{ description: "thundering herd", score: 4 }],
          recommendedChanges: ["add jitter"],
          confidenceAdjustment: "lower",
        },
      });
    },
  }) as typeof fetch;

  try {
    const env: Env = { DB: noopDb, DEVIN_API_KEY: "test-key" };
    const review = await runCriticSession(env, plan, "My task", {
      pollIntervalMs: 1,
      maxPollMs: 1000,
    });
    assert.equal(review.mode, "critic-session");
    assert.equal(review.criticSessionUrl, "https://app.devin.ai/sessions/sess-1");
    assert.deepEqual(review.weakAssumptions, [
      { category: "requirements", description: "assumes single region", relatedSubtasks: [] },
    ]);
    assert.equal(review.risks[0].score, 4);
    assert.ok(polls >= 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("runCriticSession stops the session and throws a timeout after polling", async () => {
  const original = globalThis.fetch;
  let stopCalls = 0;
  let polls = 0;
  // Deadline = 0 + 10 = 10. Loop runs once (t=1 < 10) then exits (t=100 >= 10),
  // so a non-null poll result is present when the deadline passes.
  const times = [0, 1, 100];
  let i = 0;
  globalThis.fetch = stubFetch({
    "/sessions": () => Response.json({ session_id: "sess-timeout" }),
    "/session/sess-timeout/message": () => {
      stopCalls += 1;
      return Response.json({ ok: true });
    },
    "/session/sess-timeout": () => {
      polls += 1;
      return Response.json({ status_enum: "running" });
    },
  }) as typeof fetch;

  try {
    const env: Env = { DB: noopDb, DEVIN_API_KEY: "test-key" };
    await assert.rejects(
      runCriticSession(env, plan, "My task", {
        pollIntervalMs: 1,
        maxPollMs: 10,
        now: () => times[Math.min(i++, times.length - 1)],
      }),
      /did not return a result before timeout/,
    );
    assert.equal(polls, 1);
    assert.equal(stopCalls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("run_adversarial_review falls back to Modo A when the critic session fails", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch({
    "/sessions": () => new Response("nope", { status: 500 }),
  }) as typeof fetch;

  try {
    const env: Env = { DB: fakeDb, DEVIN_API_KEY: "test-key" };
    const result = (await callTool(env, "run_adversarial_review", {
      plan_id: "plan-1",
    })) as { mode: string; fallbackReason?: string };
    assert.equal(result.mode, "in-agent");
    assert.match(result.fallbackReason ?? "", /HTTP 500/);
  } finally {
    globalThis.fetch = original;
  }
});

test("run_adversarial_review uses Modo A when no API key is configured", async () => {
  const env: Env = { DB: fakeDb };
  const result = (await callTool(env, "run_adversarial_review", { plan_id: "plan-1" })) as {
    mode: string;
    fallbackReason?: string;
  };
  assert.equal(result.mode, "in-agent");
  assert.equal(result.fallbackReason, undefined);
});
