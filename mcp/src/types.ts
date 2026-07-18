export interface Env {
  DB: D1Database;
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

export interface AdversarialReview {
  weakAssumptions: string[];
  missingEdgeCases: string[];
  risks: { description: string; score: number }[];
  recommendedChanges: string[];
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
