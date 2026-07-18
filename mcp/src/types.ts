export interface Env {
  DB: D1Database;
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

export interface Decomposition {
  subtasks: Subtask[];
  executionStrategy: ExecutionStrategy;
  estimatedComplexity: "low" | "medium" | "high";
  confidenceSummary: string;
}

export interface AdversarialReview {
  weakAssumptions: string[];
  missingEdgeCases: string[];
  risks: { description: string; score: number }[];
  recommendedChanges: string[];
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
