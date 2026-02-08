-- 1. Molecules (no FK dependencies on other graph tables)
CREATE TABLE graph_molecules (
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

-- 2. Atoms reference molecules
CREATE TABLE graph_atoms (
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

-- 3. Changelog (polymorphic)
CREATE TABLE graph_changelog (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK(parent_type IN ('atom', 'molecule')),
  parent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 4. Indexes
CREATE INDEX idx_graph_molecules_project ON graph_molecules(project_id);
CREATE INDEX idx_graph_atoms_project ON graph_atoms(project_id);
CREATE INDEX idx_graph_atoms_molecule ON graph_atoms(molecule_id);
CREATE INDEX idx_graph_changelog_parent ON graph_changelog(parent_type, parent_id);
CREATE INDEX idx_graph_changelog_task ON graph_changelog(task_id);
