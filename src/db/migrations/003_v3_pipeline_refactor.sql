-- Migration 003: v3 Pipeline Refactor
-- Major breaking migration:
-- 1. Project becomes stateless (drop status column)
-- 2. Feature/task statuses mapped to v3 pipeline states
-- 3. blocked_by, blocked_reason, related_to columns added to tasks/features
-- 4. Dependencies table dropped (blocking data extracted to fields)
-- 5. lock_status column dropped from tasks

-- ============================================================================
-- Step 1: Extract blocking data from dependencies into temporary tables
-- ============================================================================

-- For tasks: IS_BLOCKED_BY(from=A, to=B) means "A is blocked by B" -> B goes in A's blocked_by
-- In DB they were normalized to BLOCKS(from=blocker, to=blocked) -> from goes in to's blocked_by
CREATE TEMPORARY TABLE task_blockers AS
SELECT to_entity_id AS task_id,
       json_group_array(from_entity_id) AS blocker_ids
FROM dependencies
WHERE type = 'BLOCKS' AND entity_type = 'task'
GROUP BY to_entity_id;

CREATE TEMPORARY TABLE feature_blockers AS
SELECT to_entity_id AS feature_id,
       json_group_array(from_entity_id) AS blocker_ids
FROM dependencies
WHERE type = 'BLOCKS' AND entity_type = 'feature'
GROUP BY to_entity_id;

-- Extract RELATES_TO data (bidirectional, so collect both directions)
CREATE TEMPORARY TABLE task_relations AS
SELECT entity_id, json_group_array(related_id) AS related_ids FROM (
  SELECT from_entity_id AS entity_id, to_entity_id AS related_id
  FROM dependencies WHERE type = 'RELATES_TO' AND entity_type = 'task'
  UNION
  SELECT to_entity_id AS entity_id, from_entity_id AS related_id
  FROM dependencies WHERE type = 'RELATES_TO' AND entity_type = 'task'
) GROUP BY entity_id;

CREATE TEMPORARY TABLE feature_relations AS
SELECT entity_id, json_group_array(related_id) AS related_ids FROM (
  SELECT from_entity_id AS entity_id, to_entity_id AS related_id
  FROM dependencies WHERE type = 'RELATES_TO' AND entity_type = 'feature'
  UNION
  SELECT to_entity_id AS entity_id, from_entity_id AS related_id
  FROM dependencies WHERE type = 'RELATES_TO' AND entity_type = 'feature'
) GROUP BY entity_id;

-- ============================================================================
-- Step 2: Recreate projects table without status column
-- ============================================================================

CREATE TABLE projects_new (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    search_vector TEXT
);

INSERT INTO projects_new (id, name, summary, description, version, created_at, modified_at, search_vector)
SELECT id, name, summary, description, version, created_at, modified_at, search_vector
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_modified_at ON projects(modified_at);
CREATE INDEX IF NOT EXISTS idx_projects_version ON projects(version);
CREATE INDEX IF NOT EXISTS idx_projects_search_vector ON projects(search_vector);

-- ============================================================================
-- Step 3: Recreate features with v3 schema
-- ============================================================================

CREATE TABLE features_new (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'NEW',
    priority VARCHAR(10) NOT NULL CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
    blocked_by TEXT NOT NULL DEFAULT '[]',
    blocked_reason TEXT,
    related_to TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    search_vector TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Insert with status mapping and blocking data
INSERT INTO features_new (id, project_id, name, summary, description, status, priority, blocked_by, blocked_reason, related_to, version, created_at, modified_at, search_vector)
SELECT
    f.id, f.project_id, f.name, f.summary, f.description,
    CASE f.status
        WHEN 'DRAFT' THEN 'NEW'
        WHEN 'PLANNING' THEN 'NEW'
        WHEN 'IN_DEVELOPMENT' THEN 'ACTIVE'
        WHEN 'TESTING' THEN 'ACTIVE'
        WHEN 'VALIDATING' THEN 'ACTIVE'
        WHEN 'PENDING_REVIEW' THEN 'ACTIVE'
        WHEN 'BLOCKED' THEN 'ACTIVE'
        WHEN 'ON_HOLD' THEN 'NEW'
        WHEN 'DEPLOYED' THEN 'CLOSED'
        WHEN 'COMPLETED' THEN 'CLOSED'
        WHEN 'ARCHIVED' THEN 'CLOSED'
        ELSE 'NEW'
    END,
    f.priority,
    COALESCE(fb.blocker_ids, '[]'),
    NULL,
    COALESCE(fr.related_ids, '[]'),
    f.version, f.created_at, f.modified_at, f.search_vector
FROM features f
LEFT JOIN feature_blockers fb ON fb.feature_id = f.id
LEFT JOIN feature_relations fr ON fr.entity_id = f.id;

DROP TABLE features;
ALTER TABLE features_new RENAME TO features;

CREATE INDEX IF NOT EXISTS idx_features_project_id ON features(project_id);
CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
CREATE INDEX IF NOT EXISTS idx_features_priority ON features(priority);
CREATE INDEX IF NOT EXISTS idx_features_created_at ON features(created_at);
CREATE INDEX IF NOT EXISTS idx_features_modified_at ON features(modified_at);
CREATE INDEX IF NOT EXISTS idx_features_version ON features(version);
CREATE INDEX IF NOT EXISTS idx_features_search_vector ON features(search_vector);
CREATE INDEX IF NOT EXISTS idx_features_status_priority ON features(status, priority);
CREATE INDEX IF NOT EXISTS idx_features_project_status ON features(project_id, status);

-- ============================================================================
-- Step 4: Recreate tasks with v3 schema (drop lock_status, add blocking/relation fields)
-- ============================================================================

CREATE TABLE tasks_new (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    feature_id TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'NEW',
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
    complexity INTEGER NOT NULL,
    blocked_by TEXT NOT NULL DEFAULT '[]',
    blocked_reason TEXT,
    related_to TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    last_modified_by TEXT,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    search_vector TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (feature_id) REFERENCES features(id)
);

-- Insert with status mapping and blocking data
INSERT INTO tasks_new (id, project_id, feature_id, title, summary, description, status, priority, complexity, blocked_by, blocked_reason, related_to, version, last_modified_by, created_at, modified_at, search_vector)
SELECT
    t.id, t.project_id, t.feature_id, t.title, t.summary, t.description,
    CASE t.status
        WHEN 'BACKLOG' THEN 'NEW'
        WHEN 'PENDING' THEN 'NEW'
        WHEN 'IN_PROGRESS' THEN 'ACTIVE'
        WHEN 'IN_REVIEW' THEN 'ACTIVE'
        WHEN 'CHANGES_REQUESTED' THEN 'ACTIVE'
        WHEN 'TESTING' THEN 'TO_BE_TESTED'
        WHEN 'READY_FOR_QA' THEN 'TO_BE_TESTED'
        WHEN 'INVESTIGATING' THEN 'ACTIVE'
        WHEN 'BLOCKED' THEN 'ACTIVE'
        WHEN 'ON_HOLD' THEN 'NEW'
        WHEN 'DEPLOYED' THEN 'CLOSED'
        WHEN 'COMPLETED' THEN 'CLOSED'
        WHEN 'CANCELLED' THEN 'WILL_NOT_IMPLEMENT'
        WHEN 'DEFERRED' THEN 'NEW'
        ELSE 'NEW'
    END,
    t.priority, t.complexity,
    COALESCE(tb.blocker_ids, CASE WHEN t.status = 'BLOCKED' THEN '["NO_OP"]' ELSE '[]' END),
    CASE WHEN t.status = 'BLOCKED' AND tb.blocker_ids IS NULL THEN 'Migrated from BLOCKED status without specific blocker reference' ELSE NULL END,
    COALESCE(tr.related_ids, '[]'),
    t.version, t.last_modified_by, t.created_at, t.modified_at, t.search_vector
FROM tasks t
LEFT JOIN task_blockers tb ON tb.task_id = t.id
LEFT JOIN task_relations tr ON tr.entity_id = t.id;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_feature_id ON tasks(feature_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_version ON tasks(version);
CREATE INDEX IF NOT EXISTS idx_tasks_last_modified_by ON tasks(last_modified_by);
CREATE INDEX IF NOT EXISTS idx_tasks_search_vector ON tasks(search_vector);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_feature_status ON tasks(feature_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority_created ON tasks(priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_project_feature ON tasks(project_id, feature_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority_complexity ON tasks(status, priority, complexity);
CREATE INDEX IF NOT EXISTS idx_tasks_feature_status_priority ON tasks(feature_id, status, priority);

-- ============================================================================
-- Step 5: Drop dependencies table
-- ============================================================================

DROP TABLE IF EXISTS dependencies;

-- ============================================================================
-- Step 6: Clean up temporary tables
-- ============================================================================

DROP TABLE IF EXISTS task_blockers;
DROP TABLE IF EXISTS feature_blockers;
DROP TABLE IF EXISTS task_relations;
DROP TABLE IF EXISTS feature_relations;
