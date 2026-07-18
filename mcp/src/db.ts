import type { AdversarialReview, Env, MemoryEntry, Plan } from "./types.js";

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function insertPlan(
  env: Env,
  plan: Omit<Plan, "id" | "createdAt">,
): Promise<Plan> {
  const id = uuid();
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO plans (id, workspace, original_task, decomposition, confidence_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      plan.workspace,
      plan.originalTask,
      JSON.stringify(plan.decomposition),
      plan.confidenceSummary,
      createdAt,
    )
    .run();
  return { ...plan, id, createdAt };
}

export async function getPlan(env: Env, id: string): Promise<Plan | null> {
  const row = await env.DB.prepare(
    `SELECT id, workspace, original_task, decomposition, confidence_summary, created_at
     FROM plans WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      workspace: string | null;
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
  await env.DB.prepare(
    `INSERT INTO memory (id, workspace, key, value, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, entry.workspace, entry.key, entry.value, entry.tags.join(","), createdAt)
    .run();
  return { ...entry, id, createdAt };
}

export async function listMemory(
  env: Env,
  workspace: string | null,
  limit = 100,
): Promise<MemoryEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, workspace, key, value, tags, created_at
     FROM memory
     WHERE (workspace IS ? OR ? IS NULL)
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(workspace, workspace, limit)
    .all<{
      id: string;
      workspace: string | null;
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

export async function queryMemory(
  env: Env,
  workspace: string | null,
  query: string,
): Promise<MemoryEntry[]> {
  const like = `%${query}%`;
  const { results } = await env.DB.prepare(
    `SELECT id, workspace, key, value, tags, created_at
     FROM memory
     WHERE (workspace IS ? OR ? IS NULL)
       AND (key LIKE ? OR value LIKE ? OR tags LIKE ?)
     ORDER BY created_at DESC
     LIMIT 25`,
  )
    .bind(workspace, workspace, like, like, like)
    .all<{
      id: string;
      workspace: string | null;
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
