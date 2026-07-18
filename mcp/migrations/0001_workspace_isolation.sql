-- Migration: workspace isolation / multi-tenancy (issue #22)
-- Apply with: wrangler d1 execute devin_scope --file=./migrations/0001_workspace_isolation.sql
--
-- Brings databases created with the original schema up to the workspace-scoped
-- model. Safe to run once on an existing database; fresh databases created from
-- schema.sql already include these columns/indexes.
--
-- 1) Backfill NULL/empty workspaces on existing rows to the canonical default so
--    no row is left in an unscoped ("match anything") state.
UPDATE plans SET workspace = 'default' WHERE workspace IS NULL OR workspace = '';
UPDATE memory SET workspace = 'default' WHERE workspace IS NULL OR workspace = '';

-- 2) Add the workspace column to reviews (older schema lacked it). SQLite ADD
--    COLUMN backfills every existing row with the default value.
ALTER TABLE reviews ADD COLUMN workspace TEXT NOT NULL DEFAULT 'default';

-- 3) Inherit each review's workspace from its parent plan where known.
UPDATE reviews
SET workspace = (SELECT p.workspace FROM plans p WHERE p.id = reviews.plan_id)
WHERE EXISTS (SELECT 1 FROM plans p WHERE p.id = reviews.plan_id);

-- 4) Ensure the scoping indexes exist.
CREATE INDEX IF NOT EXISTS idx_plans_workspace ON plans(workspace);
CREATE INDEX IF NOT EXISTS idx_reviews_workspace ON reviews(workspace);
CREATE INDEX IF NOT EXISTS idx_memory_workspace_key ON memory(workspace, key);
