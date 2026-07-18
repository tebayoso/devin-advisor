export interface Env {
  DB: D1Database;
  // Optional Cloudflare Workers AI binding for model-backed task decomposition.
  // When absent, decompose_task falls back to a deterministic heuristic.
  AI?: Ai;
  // Optional override for the Workers AI text-generation model id.
  DECOMPOSE_MODEL?: string;
  // Optional shared Bearer token. When set, requests to /mcp must include
  // `Authorization: Bearer <AUTH_TOKEN>`. When unset, the server is public.
  AUTH_TOKEN?: string;
  // Optional "Modo B" configuration. When DEVIN_API_KEY is set, the adversarial
  // review can be delegated to a short, separate critic Devin session via the
  // Devin REST API. Provided as a Worker secret; never hardcoded.
  DEVIN_API_KEY?: string;
  // Optional override for the Devin API base URL (defaults to the public API).
  DEVIN_API_BASE_URL?: string;
}

export type Confidence = "high" | "medium" | "low";

export type ExecutionStrategy = "parallel" | "sequential" | "managed-devins";

export interface Subtask {
  id: string;
  title: string;
  description: string;
  confidence: Confidence;
  justification: string;
  dependsOn: string[];
}

export type Complexity = "low" | "medium" | "high";

export type ModelTier = "lite" | "standard" | "advanced";

export type RoutingEnvironment = "local" | "cloud";

export interface SubtaskRouting {
  subtaskId: string;
  model: ModelTier;
  environment: RoutingEnvironment;
  rationale: string;
}

export interface RoutingSuggestion {
  recommendedModel: ModelTier;
  environment: RoutingEnvironment;
  parallelDevins: number;
  perSubtask: SubtaskRouting[];
  rationale: string;
}

export interface Decomposition {
  subtasks: Subtask[];
  executionStrategy: ExecutionStrategy;
  estimatedComplexity: Complexity;
  confidenceSummary: string;
  routing: RoutingSuggestion;
}

// Shared taxonomy for categorizing adversarial critiques (assumptions, edge
// cases and risks) so reviews are consistent and filterable.
export type CritiqueCategory =
  | "requirements"
  | "scope"
  | "dependencies"
  | "error-handling"
  | "input-validation"
  | "concurrency"
  | "performance"
  | "security"
  | "data-integrity"
  | "integration"
  | "observability"
  | "rollback"
  | "testing";

export type RiskLevel = "low" | "medium" | "high";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface CategorizedItem {
  category: CritiqueCategory;
  description: string;
  relatedSubtasks: string[];
}

// Quantified, explained risk. `score` = likelihood(1-3) x impact(1-3) (1-9);
// `severity` is derived from `score` via fixed thresholds.
export interface ScoredRisk {
  description: string;
  category: CritiqueCategory;
  likelihood: RiskLevel;
  impact: RiskLevel;
  score: number;
  severity: RiskSeverity;
  explanation: string;
  relatedSubtasks: string[];
}

export interface RiskSummary {
  riskCount: number;
  overallScore: number;
  highestSeverity: RiskSeverity;
  scoringModel: string;
}

export interface AdversarialReview {
  weakAssumptions: CategorizedItem[];
  missingEdgeCases: CategorizedItem[];
  risks: ScoredRisk[];
  recommendedChanges: string[];
  historicalInsights: string[];
  riskSummary: RiskSummary;
  confidenceAdjustment: string;
  // How the review was produced: "in-agent" (Modo A) or "critic-session" (Modo B).
  mode?: "in-agent" | "critic-session";
  // URL of the critic Devin session, when Modo B was used.
  criticSessionUrl?: string;
  // Populated when Modo B was attempted but fell back to Modo A.
  fallbackReason?: string;
}

export interface Plan {
  id: string;
  workspace: string;
  originalTask: string;
  decomposition: Decomposition;
  confidenceSummary: string | null;
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  workspace: string;
  key: string;
  value: string;
  tags: string[];
  createdAt: string;
}

export type PromotionTarget = "knowledge" | "playbook";

export interface PromotionCheck {
  id: string;
  label: string;
  passed: boolean;
  mandatory: boolean;
  weight: number;
  detail: string;
}

export interface QualityAssessment {
  eligible: boolean;
  score: number; // 0-100
  threshold: number;
  checks: PromotionCheck[];
  reasons: string[]; // human-readable pass reasons
  failures: string[]; // human-readable reasons the plan is not (yet) promotable
}

export interface KnowledgeArtifact {
  name: string;
  triggerDescription: string;
  tags: string[];
  body: string;
}

export interface PlaybookArtifact {
  name: string;
  slug: string;
  content: string;
}

export interface SuggestedMcpCall {
  server: string;
  tool: string;
  description: string;
  arguments: Record<string, unknown>;
}

export interface PromotionResult {
  assessment: QualityAssessment;
  target: PromotionTarget | null;
  knowledge?: KnowledgeArtifact;
  playbook?: PlaybookArtifact;
  suggestedMcpCalls: SuggestedMcpCall[];
  flow: string[];
}

// Minimal MCP / JSON-RPC 2.0 shapes used by the Streamable HTTP handler.
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
