// "Modo B" — optional adversarial review delegated to a separate critic Devin
// session via the Devin REST API. When a Devin API key is not configured, callers
// fall back to "Modo A" (the in-agent structured prompt). No secrets are hardcoded:
// the key is read from the Worker environment (env.DEVIN_API_KEY).

import { riskScore, severityFromScore, SCORING_MODEL } from "./review.js";
import type {
  AdversarialReview,
  CategorizedItem,
  CritiqueCategory,
  Env,
  Plan,
  RiskLevel,
  RiskSeverity,
  ScoredRisk,
} from "./types.js";

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
        weakAssumptions: [
          { category: "requirements", description: "string", relatedSubtasks: ["s1"] },
        ],
        missingEdgeCases: [
          { category: "error-handling", description: "string", relatedSubtasks: [] },
        ],
        risks: [
          {
            description: "string",
            category: "security",
            likelihood: "low|medium|high",
            impact: "low|medium|high",
            explanation: "string",
          },
        ],
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

const VALID_CATEGORIES: ReadonlySet<string> = new Set<CritiqueCategory>([
  "requirements", "scope", "dependencies", "error-handling", "input-validation",
  "concurrency", "performance", "security", "data-integrity", "integration",
  "observability", "rollback", "testing",
]);

const SEVERITY_ORDER: RiskSeverity[] = ["low", "medium", "high", "critical"];

function asCategory(value: unknown): CritiqueCategory {
  return typeof value === "string" && VALID_CATEGORIES.has(value)
    ? (value as CritiqueCategory)
    : "requirements";
}

function asRiskLevel(value: unknown, fallback: RiskLevel = "medium"): RiskLevel {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

// Accept either a list of strings or of {category, description, relatedSubtasks}
// objects and normalize into the categorized shape the current schema expects.
function asCategorizedItems(value: unknown): CategorizedItem[] {
  if (!Array.isArray(value)) return [];
  const items: CategorizedItem[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      items.push({ category: "requirements", description: item, relatedSubtasks: [] });
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const description = typeof rec.description === "string" ? rec.description : undefined;
      if (description) {
        items.push({
          category: asCategory(rec.category),
          description,
          relatedSubtasks: asStringArray(rec.relatedSubtasks),
        });
      }
    }
  }
  return items;
}

// Normalize risks into ScoredRisk, deriving score/severity from likelihood x
// impact (or clamping a directly-provided numeric score into the 1-9 range).
function asScoredRisks(value: unknown): ScoredRisk[] {
  if (!Array.isArray(value)) return [];
  const risks: ScoredRisk[] = [];
  for (const item of value) {
    let description: string | undefined;
    let category: CritiqueCategory = "requirements";
    let likelihood: RiskLevel = "medium";
    let impact: RiskLevel = "medium";
    let explanation = "";
    let relatedSubtasks: string[] = [];
    let providedScore: number | undefined;
    if (typeof item === "string") {
      description = item;
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      description = typeof rec.description === "string" ? rec.description : undefined;
      category = asCategory(rec.category);
      likelihood = asRiskLevel(rec.likelihood);
      impact = asRiskLevel(rec.impact);
      explanation = typeof rec.explanation === "string" ? rec.explanation : "";
      relatedSubtasks = asStringArray(rec.relatedSubtasks);
      if (typeof rec.score === "number") providedScore = rec.score;
    }
    if (description === undefined) continue;
    const score =
      providedScore !== undefined
        ? Math.min(9, Math.max(1, Math.round(providedScore)))
        : riskScore(likelihood, impact);
    risks.push({
      description,
      category,
      likelihood,
      impact,
      score,
      severity: severityFromScore(score),
      explanation,
      relatedSubtasks,
    });
  }
  return risks;
}

/**
 * Coerce a critic session's structured output into an AdversarialReview.
 * Accepts both the flat and the categorized output shapes and normalizes into
 * the current rich schema. Throws when the output contains no usable critique,
 * so the caller can fall back to Modo A.
 */
export function parseAdversarialReview(output: unknown): AdversarialReview {
  if (!output || typeof output !== "object") {
    throw new Error("Critic session returned no structured output");
  }
  const rec = output as Record<string, unknown>;
  const weakAssumptions = asCategorizedItems(rec.weakAssumptions);
  const missingEdgeCases = asCategorizedItems(rec.missingEdgeCases);
  const risks = asScoredRisks(rec.risks);
  const recommendedChanges = asStringArray(rec.recommendedChanges);
  const historicalInsights = asStringArray(rec.historicalInsights);

  const hasContent =
    weakAssumptions.length > 0 ||
    missingEdgeCases.length > 0 ||
    risks.length > 0 ||
    recommendedChanges.length > 0;
  if (!hasContent) {
    throw new Error("Critic session structured output contained no critique");
  }

  const overallScore = risks.length
    ? Math.round((risks.reduce((sum, r) => sum + r.score, 0) / risks.length) * 10) / 10
    : 0;
  const highestSeverity = risks.reduce<RiskSeverity>(
    (max, r) =>
      SEVERITY_ORDER.indexOf(r.severity) > SEVERITY_ORDER.indexOf(max) ? r.severity : max,
    "low",
  );

  return {
    weakAssumptions,
    missingEdgeCases,
    risks,
    recommendedChanges,
    historicalInsights,
    riskSummary: {
      riskCount: risks.length,
      overallScore,
      highestSeverity,
      scoringModel: SCORING_MODEL,
    },
    confidenceAdjustment:
      typeof rec.confidenceAdjustment === "string" ? rec.confidenceAdjustment : "",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const deadline = now() + maxPollMs;
  let detail: SessionDetail | null = null;
  while (now() < deadline) {
    await sleep(pollIntervalMs);
    const res = await fetch(`${url}/session/${created.session_id}`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to poll critic session: HTTP ${res.status}`);
    }
    detail = (await res.json()) as SessionDetail;
    const status = detail.status_enum?.toLowerCase();
    if (detail.structured_output || (status && TERMINAL_STATUSES.has(status))) {
      break;
    }
  }

  if (!detail) {
    throw new Error("Critic session did not return a result before timeout");
  }
  const review = parseAdversarialReview(detail.structured_output);
  review.mode = "critic-session";
  if (created.url) review.criticSessionUrl = created.url;
  return review;
}
