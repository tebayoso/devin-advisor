-- devin-scope Cloudflare D1 schema
-- Apply with: wrangler d1 execute devin_scope --file=./schema.sql
--
-- Every tenant-scoped table carries a NOT NULL `workspace` column defaulting to
-- 'default' so rows are always isolated per workspace (see mcp/src/db.ts).

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  original_task TEXT NOT NULL,
  decomposition TEXT NOT NULL, -- JSON
  confidence_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'default',
  critique TEXT NOT NULL, -- JSON
  risks TEXT,             -- JSON
  missing_cases TEXT,     -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_workspace ON plans(workspace);
CREATE INDEX IF NOT EXISTS idx_reviews_plan_id ON reviews(plan_id);
CREATE INDEX IF NOT EXISTS idx_reviews_workspace ON reviews(workspace);
CREATE INDEX IF NOT EXISTS idx_memory_workspace_key ON memory(workspace, key);
