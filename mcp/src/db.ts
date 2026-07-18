import type { AdversarialReview, Env, MemoryEntry, Plan } from "./types.js";

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

// Canonical workspace used when a caller does not provide one. Every row is
// scoped to a concrete workspace so that a missing/empty workspace behaves like
// a real tenant bucket instead of an implicit "match anything" wildcard.
export const DEFAULT_WORKSPACE = "default";

// Normalize a caller-supplied workspace into a concrete, non-empty id. This is
// the single source of truth for workspace scoping across every tool and query.
export function normalizeWorkspace(workspace: string | null | undefined): string {
  const trimmed = workspace?.trim();
  return trimmed ? trimmed : DEFAULT_WORKSPACE;
}

export async function insertPlan(
  env: Env,
  plan: Omit<Plan, "id" | "createdAt">,
): Promise<Plan> {
  const id = uuid();
  const createdAt = nowIso();
  const workspace = normalizeWorkspace(plan.workspace);
  await env.DB.prepare(
    `INSERT INTO plans (id, workspace, original_task, decomposition, confidence_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspace,
      plan.originalTask,
      JSON.stringify(plan.decomposition),
      plan.confidenceSummary,
      createdAt,
    )
    .run();
  return { ...plan, workspace, id, createdAt };
}

export async function getPlan(
  env: Env,
  id: string,
  workspace: string | null | undefined,
): Promise<Plan | null> {
  const row = await env.DB.prepare(
    `SELECT id, workspace, original_task, decomposition, confidence_summary, created_at
     FROM plans WHERE id = ? AND workspace = ?`,
  )
    .bind(id, normalizeWorkspace(workspace))
    .first<{
      id: string;
      workspace: string;
      original_task: string;
      decomposition: string;
      confidence_summary: string | null;
      created_at: string;
    }>();

  if (!row) return null;
  return {
    id: row.id,
    workspace: row.workspace,
    originalTask: row.original_task,
    decomposition: JSON.parse(row.decomposition),
    confidenceSummary: row.confidence_summary,
    createdAt: row.created_at,
  };
}

export async function insertReview(
  env: Env,
  planId: string,
  review: AdversarialReview,
): Promise<{ id: string; createdAt: string }> {
  const id = uuid();
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO reviews (id, plan_id, critique, risks, missing_cases, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      planId,
      JSON.stringify(review),
      JSON.stringify(review.risks),
      JSON.stringify(review.missingEdgeCases),
      createdAt,
    )
    .run();
  return { id, createdAt };
}

export async function saveMemory(
  env: Env,
  entry: Omit<MemoryEntry, "id" | "createdAt">,
): Promise<MemoryEntry> {
  const id = uuid();
  const createdAt = nowIso();
  const workspace = normalizeWorkspace(entry.workspace);
  await env.DB.prepare(
    `INSERT INTO memory (id, workspace, key, value, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, workspace, entry.key, entry.value, entry.tags.join(","), createdAt)
    .run();
  return { ...entry, workspace, id, createdAt };
}

export async function queryMemory(
  env: Env,
  workspace: string | null | undefined,
  query: string,
): Promise<MemoryEntry[]> {
  const like = `%${query}%`;
  const { results } = await env.DB.prepare(
    `SELECT id, workspace, key, value, tags, created_at
     FROM memory
     WHERE workspace = ?
       AND (key LIKE ? OR value LIKE ? OR tags LIKE ?)
     ORDER BY created_at DESC
     LIMIT 25`,
  )
    .bind(normalizeWorkspace(workspace), like, like, like)
    .all<{
      id: string;
      workspace: string;
      key: string;
      value: string;
      tags: string | null;
      created_at: string;
    }>();

  return results.map((row) => ({
    id: row.id,
    workspace: row.workspace,
    key: row.key,
    value: row.value,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    createdAt: row.created_at,
  }));
}
