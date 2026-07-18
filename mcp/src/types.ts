export interface Env {
  DB: D1Database;
  // Linear / Jira ticket integration (optional; required only for ticket tools).
  LINEAR_API_KEY?: string;
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  JIRA_API_TOKEN?: string;
}

export type TicketProvider = "linear" | "jira";

export interface TicketRef {
  provider: TicketProvider;
  id: string;
}

export interface TicketData {
  provider: TicketProvider;
  id: string;
  title: string;
  description: string;
  url: string;
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
