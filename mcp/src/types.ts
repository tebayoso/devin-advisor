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

export interface Decomposition {
  subtasks: Subtask[];
  executionStrategy: ExecutionStrategy;
  estimatedComplexity: "low" | "medium" | "high";
  confidenceSummary: string;
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
}

export interface Plan {
  id: string;
  workspace: string | null;
  originalTask: string;
  decomposition: Decomposition;
  confidenceSummary: string | null;
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  workspace: string | null;
  key: string;
  value: string;
  tags: string[];
  createdAt: string;
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
