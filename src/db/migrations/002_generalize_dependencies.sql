-- Migration 002: Generalize dependencies table for polymorphic entity references
-- Renames task-specific columns to entity-generic ones and adds entity_type discriminator

-- Step 1: Create new table with generalized schema
CREATE TABLE IF NOT EXISTS dependencies_new (
    id TEXT PRIMARY KEY,
    from_entity_id TEXT NOT NULL,
    to_entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'task' CHECK (entity_type IN ('task', 'feature')),
    type VARCHAR(20) NOT NULL CHECK (type IN ('BLOCKS', 'IS_BLOCKED_BY', 'RELATES_TO')),
    created_at TEXT NOT NULL
);

-- Step 2: Copy existing data, mapping old columns to new and defaulting entity_type to 'task'
INSERT INTO dependencies_new (id, from_entity_id, to_entity_id, entity_type, type, created_at)
SELECT id, from_task_id, to_task_id, 'task', type, created_at
FROM dependencies;

-- Step 3: Drop old table and rename new one
DROP TABLE IF EXISTS dependencies;
ALTER TABLE dependencies_new RENAME TO dependencies;

-- Step 4: Recreate indexes with new column names
CREATE UNIQUE INDEX IF NOT EXISTS idx_dependencies_unique ON dependencies(from_entity_id, to_entity_id, type, entity_type);
CREATE INDEX IF NOT EXISTS idx_dependencies_from_entity_id ON dependencies(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_to_entity_id ON dependencies(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_entity_type ON dependencies(entity_type);
