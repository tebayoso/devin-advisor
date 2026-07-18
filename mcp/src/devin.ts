// "Modo B" — optional adversarial review delegated to a separate critic Devin
// session via the Devin REST API. When a Devin API key is not configured, callers
// fall back to "Modo A" (the in-agent structured prompt). No secrets are hardcoded:
// the key is read from the Worker environment (env.DEVIN_API_KEY).

import type { AdversarialReview, Env, Plan } from "./types.js";

const DEFAULT_BASE_URL = "https://api.devin.ai/v1";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 180_000;

// Session statuses that mean the critic session is done working.
const TERMINAL_STATUSES = new Set([
  "blocked",
  "stopped",
  "finished",
  "expired",
  "suspended",
]);

/** Whether Modo B (critic session) is available given the current environment. */
export function devinApiConfigured(env: Env): boolean {
  return typeof env.DEVIN_API_KEY === "string" && env.DEVIN_API_KEY.trim().length > 0;
}

function baseUrl(env: Env): string {
  const raw = env.DEVIN_API_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Build the adversarial-critic prompt sent to the spawned Devin session. */
export function buildCriticPrompt(originalTask: string | undefined, plan: Plan | null): string {
  const task = originalTask ?? plan?.originalTask ?? "(task not provided)";
  const decomposition = plan
    ? JSON.stringify(plan.decomposition, null, 2)
    : "(plan could not be loaded; critique based on the task alone)";
  return [
    "You are an adversarial reviewer (a red-team critic) for an engineering execution plan.",
    "Do NOT implement anything and do NOT open a PR. Your only job is to critique the plan below.",
    "",
    `Original task:\n${task}`,
    "",
    `Proposed decomposition (JSON):\n${decomposition}`,
    "",
    "Actively look for weak or unstated assumptions, missing edge cases and failure modes,",
    "risks (with a severity score from 1=low to 5=critical), and concrete recommended changes.",
    "",
    "When finished, call provide_structured_output with EXACTLY this JSON shape:",
    JSON.stringify(
      {
        weakAssumptions: ["string"],
        missingEdgeCases: ["string"],
        risks: [{ description: "string", score: 1 }],
        recommendedChanges: ["string"],
        confidenceAdjustment: "string",
      },
      null,
      2,
    ),
    "",
    "Keep the session short and cheap. Return at least three concrete, actionable critiques.",
  ].join("\n");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asRisks(value: unknown): { description: string; score: number }[] {
  if (!Array.isArray(value)) return [];
  const risks: { description: string; score: number }[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const description = typeof rec.description === "string" ? rec.description : undefined;
      const score = typeof rec.score === "number" ? rec.score : undefined;
      if (description !== undefined) {
        risks.push({ description, score: score ?? 3 });
      }
    } else if (typeof item === "string") {
      risks.push({ description: item, score: 3 });
    }
  }
  return risks;
}

/**
 * Coerce a critic session's structured output into an AdversarialReview.
 * Throws when the output does not contain any usable critique, so the caller can
 * fall back to Modo A.
 */
export function parseAdversarialReview(output: unknown): AdversarialReview {
  if (!output || typeof output !== "object") {
    throw new Error("Critic session returned no structured output");
  }
  const rec = output as Record<string, unknown>;
  const review: AdversarialReview = {
    weakAssumptions: asStringArray(rec.weakAssumptions),
    missingEdgeCases: asStringArray(rec.missingEdgeCases),
    risks: asRisks(rec.risks),
    recommendedChanges: asStringArray(rec.recommendedChanges),
    confidenceAdjustment:
      typeof rec.confidenceAdjustment === "string" ? rec.confidenceAdjustment : "",
  };

  const hasContent =
    review.weakAssumptions.length > 0 ||
    review.missingEdgeCases.length > 0 ||
    review.risks.length > 0 ||
    review.recommendedChanges.length > 0;
  if (!hasContent) {
    throw new Error("Critic session structured output contained no critique");
  }
  return review;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort request to stop an abandoned critic session so it stops consuming
 * compute credits once we've given up waiting for it. Failures are swallowed so
 * they never mask the original fallback reason.
 */
async function stopCriticSession(
  url: string,
  headers: Record<string, string>,
  sessionId: string,
): Promise<void> {
  try {
    await fetch(`${url}/session/${sessionId}/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message:
          "The devin-scope adversarial review was abandoned (timeout or unusable output). " +
          "Stop working and end the session now to avoid consuming further credits.",
      }),
    });
  } catch {
    // Best-effort cleanup only; ignore any failure.
  }
}

interface CreateSessionResponse {
  session_id: string;
  url?: string;
}

interface SessionDetail {
  status_enum?: string;
  structured_output?: unknown;
}

/**
 * Spawn a short critic Devin session, poll until it completes, and return its
 * structured adversarial review. Throws on any failure so callers can fall back
 * to Modo A. Timing knobs are injectable to keep the orchestration testable.
 */
export async function runCriticSession(
  env: Env,
  plan: Plan | null,
  originalTask: string | undefined,
  opts: { pollIntervalMs?: number; maxPollMs?: number; now?: () => number } = {},
): Promise<AdversarialReview> {
  const apiKey = env.DEVIN_API_KEY;
  if (!apiKey) throw new Error("DEVIN_API_KEY is not configured");

  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const maxPollMs = opts.maxPollMs ?? MAX_POLL_MS;
  const now = opts.now ?? (() => Date.now());
  const url = baseUrl(env);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const createRes = await fetch(`${url}/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: buildCriticPrompt(originalTask, plan),
      title: "devin-scope adversarial critic",
      tags: ["devin-scope", "adversarial-review"],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create critic session: HTTP ${createRes.status}`);
  }
  const created = (await createRes.json()) as CreateSessionResponse;
  if (!created.session_id) {
    throw new Error("Critic session creation returned no session_id");
  }

  let succeeded = false;
  try {
    const deadline = now() + maxPollMs;
    let detail: SessionDetail | null = null;
    let done = false;
    while (now() < deadline) {
      await sleep(pollIntervalMs);
      const res = await fetch(`${url}/session/${created.session_id}`, { headers });
      if (!res.ok) {
        throw new Error(`Failed to poll critic session: HTTP ${res.status}`);
      }
      detail = (await res.json()) as SessionDetail;
      const status = detail.status_enum?.toLowerCase();
      if (detail.structured_output || (status && TERMINAL_STATUSES.has(status))) {
        done = true;
        break;
      }
    }

    if (!done || !detail) {
      throw new Error("Critic session did not return a result before timeout");
    }
    const review = parseAdversarialReview(detail.structured_output);
    review.mode = "critic-session";
    if (created.url) review.criticSessionUrl = created.url;
    succeeded = true;
    return review;
  } finally {
    // Abandoned (timeout, poll error, or unusable output): best-effort stop so
    // the session doesn't keep running and consuming credits.
    if (!succeeded) {
      await stopCriticSession(url, headers, created.session_id);
    }
  }
}
