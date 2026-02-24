import { db } from './client';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

interface SchemaIssue {
  table: string;
  missingColumns: string[];
}

const MIGRATION_FILE_PATTERN = /^(\d{3})_.*\.sql$/;
const REQUIRED_TABLES = [
  'projects',
  'features',
  'tasks',
  'sections',
  'templates',
  'template_sections',
  'entity_tags',
  'graph_molecules',
  'graph_atoms',
  'graph_changelog',
  '_meta',
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  projects: ['id', 'name', 'summary', 'version', 'created_at', 'modified_at'],
  features: ['id', 'project_id', 'status', 'blocked_by', 'blocked_reason', 'related_to', 'version'],
  tasks: [
    'id',
    'project_id',
    'feature_id',
    'status',
    'blocked_by',
    'blocked_reason',
    'related_to',
    'version',
    'last_modified_by',
  ],
  _meta: ['key', 'value', 'updated_at'],
};

function loadMigrations(): Migration[] {
  const migrationsDir = join(dirname(import.meta.path), 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(file => MIGRATION_FILE_PATTERN.test(file))
    .sort();

  return files.map(file => {
    const match = file.match(MIGRATION_FILE_PATTERN);
    if (!match) {
      throw new Error(`Invalid migration filename: ${file}`);
    }

    return {
      version: Number.parseInt(match[1], 10),
      name: file,
      sql: readFileSync(join(migrationsDir, file), 'utf-8'),
    };
  });
}

function ensureMigrationsTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function getAppliedMigrations(): Map<number, string> {
  const rows = db
    .query<{ version: number; name: string }, []>('SELECT version, name FROM _migrations')
    .all();

  return new Map(rows.map(row => [row.version, row.name]));
}

function assertMigrationHistory(
  appliedMigrations: Map<number, string>,
  migrations: Migration[]
): void {
  for (const migration of migrations) {
    const existingName = appliedMigrations.get(migration.version);
    if (existingName && existingName !== migration.name) {
      throw new Error(
        `Incompatible migration history at version ${migration.version}: found "${existingName}" but expected "${migration.name}". ` +
        'This datastore belongs to a different schema lineage. Point TASK_ORCHESTRATOR_HOME to the intended datastore or run sync with override: true.'
      );
    }
  }
}

function applyMigration(migration: Migration): void {
  db.transaction(() => {
    db.run(migration.sql);
    db.run(
      'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
      [migration.version, migration.name, new Date().toISOString()]
    );
  })();
}

function tableExists(tableName: string): boolean {
  const row = db
    .query<{ found: number }, [string]>(
      `SELECT 1 as found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
    )
    .get(tableName);

  return row?.found === 1;
}

function getTableColumns(tableName: string): Set<string> {
  const rows = db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all();
  return new Set(rows.map(row => row.name));
}

function collectSchemaIssues(): { missingTables: string[]; issues: SchemaIssue[] } {
  const missingTables = REQUIRED_TABLES.filter(table => !tableExists(table));
  const issues: SchemaIssue[] = [];

  for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tableExists(table)) continue;

    const columns = getTableColumns(table);
    const missingColumns = requiredColumns.filter(column => !columns.has(column));
    if (missingColumns.length > 0) {
      issues.push({ table, missingColumns });
    }
  }

  return { missingTables, issues };
}

function applySchemaRepair(migration: Migration): void {
  db.transaction(() => {
    db.run(migration.sql);
  })();
}

function assertSchemaCompatibility(): void {
  const { missingTables, issues } = collectSchemaIssues();
  if (missingTables.length === 0 && issues.length === 0) {
    return;
  }

  const problems: string[] = [];
  if (missingTables.length > 0) {
    problems.push(`missing tables: ${missingTables.join(', ')}`);
  }
  for (const issue of issues) {
    problems.push(`${issue.table} missing columns: ${issue.missingColumns.join(', ')}`);
  }

  throw new Error(
    `Database schema is incompatible with task-orchestrator v3 (${problems.join(' | ')}). ` +
    'You may be connected to an old or unintended datastore.'
  );
}

export function runMigrations(): void {
  ensureMigrationsTable();

  const migrations = loadMigrations();
  const appliedMigrations = getAppliedMigrations();

  assertMigrationHistory(appliedMigrations, migrations);

  for (const migration of migrations) {
    if (appliedMigrations.has(migration.version)) continue;

    applyMigration(migration);
  }

  // Backward-compatible repair for older installs where version 1 existed
  // before all tables were consolidated into the same SQL file.
  if (migrations.length === 1) {
    const { missingTables } = collectSchemaIssues();
    if (missingTables.length > 0) {
      applySchemaRepair(migrations[0]);
    }
  }

  assertSchemaCompatibility();
}
