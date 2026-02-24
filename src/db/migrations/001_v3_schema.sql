-- Task Orchestrator v3 consolidated schema

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    search_vector TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_modified_at ON projects(modified_at);
CREATE INDEX IF NOT EXISTS idx_projects_version ON projects(version);
CREATE INDEX IF NOT EXISTS idx_projects_search_vector ON projects(search_vector);

CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    target_entity_type VARCHAR(50) NOT NULL,
    is_built_in INTEGER NOT NULL DEFAULT 0,
    is_protected INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_by VARCHAR(200),
    tags TEXT NOT NULL,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_target_entity_type ON templates(target_entity_type);
CREATE INDEX IF NOT EXISTS idx_templates_is_built_in ON templates(is_built_in);
CREATE INDEX IF NOT EXISTS idx_templates_is_enabled ON templates(is_enabled);

CREATE TABLE IF NOT EXISTS features (
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

CREATE INDEX IF NOT EXISTS idx_features_project_id ON features(project_id);
CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
CREATE INDEX IF NOT EXISTS idx_features_priority ON features(priority);
CREATE INDEX IF NOT EXISTS idx_features_created_at ON features(created_at);
CREATE INDEX IF NOT EXISTS idx_features_modified_at ON features(modified_at);
CREATE INDEX IF NOT EXISTS idx_features_version ON features(version);
CREATE INDEX IF NOT EXISTS idx_features_search_vector ON features(search_vector);
CREATE INDEX IF NOT EXISTS idx_features_status_priority ON features(status, priority);
CREATE INDEX IF NOT EXISTS idx_features_project_status ON features(project_id, status);

CREATE TABLE IF NOT EXISTS entity_tags (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    tag VARCHAR(100) NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_tags_unique ON entity_tags(entity_id, entity_type, tag);
CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(tag);
CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(entity_id, entity_type);

CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    entity_id TEXT NOT NULL,
    title VARCHAR(200) NOT NULL,
    usage_description TEXT NOT NULL,
    content TEXT NOT NULL,
    content_format VARCHAR(50) NOT NULL,
    ordinal INTEGER NOT NULL,
    tags TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sections_entity ON sections(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sections_entity_id ON sections(entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_entity_ordinal ON sections(entity_type, entity_id, ordinal);

CREATE TABLE IF NOT EXISTS template_sections (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    title VARCHAR(200) NOT NULL,
    usage_description TEXT NOT NULL,
    content_sample TEXT NOT NULL,
    content_format VARCHAR(50) NOT NULL,
    ordinal INTEGER NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL,
    FOREIGN KEY (template_id) REFERENCES templates(id)
);

CREATE INDEX IF NOT EXISTS idx_template_sections_template_id ON template_sections(template_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_sections_template_ordinal ON template_sections(template_id, ordinal);

CREATE TABLE IF NOT EXISTS tasks (
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

CREATE TABLE IF NOT EXISTS graph_molecules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    knowledge TEXT NOT NULL DEFAULT '',
    related_molecules TEXT NOT NULL DEFAULT '[]',
    created_by_task_id TEXT NOT NULL,
    last_task_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_atoms (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    molecule_id TEXT REFERENCES graph_molecules(id),
    name TEXT NOT NULL,
    paths TEXT NOT NULL DEFAULT '[]',
    knowledge TEXT NOT NULL DEFAULT '',
    related_atoms TEXT NOT NULL DEFAULT '[]',
    created_by_task_id TEXT NOT NULL,
    last_task_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_changelog (
    id TEXT PRIMARY KEY,
    parent_type TEXT NOT NULL CHECK(parent_type IN ('atom', 'molecule')),
    parent_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_molecules_project ON graph_molecules(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_atoms_project ON graph_atoms(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_atoms_molecule ON graph_atoms(molecule_id);
CREATE INDEX IF NOT EXISTS idx_graph_changelog_parent ON graph_changelog(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_graph_changelog_task ON graph_changelog(task_id);

CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO _meta (key, value, updated_at)
VALUES ('schema_id', 'task-orchestrator-v3', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at;
