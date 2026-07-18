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
