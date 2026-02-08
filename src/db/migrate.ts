import { db } from './client';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const migrationsDir = join(dirname(import.meta.path), 'migrations');
  const files = ['001_initial_schema.sql', '002_generalize_dependencies.sql', '003_v3_pipeline_refactor.sql'];

  return files.map((file, i) => ({
    version: i + 1,
    name: file,
    sql: readFileSync(join(migrationsDir, file), 'utf-8')
  }));
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

function applyStandardMigration(migration: Migration): void {
  db.transaction(() => {
    db.run(migration.sql);
    db.run(
      'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
      [migration.version, migration.name, new Date().toISOString()]
    );
  })();
}

function applyV3Migration(migration: Migration): void {
  db.run('PRAGMA foreign_keys = OFF');

  try {
    db.run('BEGIN');
    db.run(migration.sql);
    db.run(
      'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
      [migration.version, migration.name, new Date().toISOString()]
    );
    db.run('COMMIT');
  } catch (error) {
    try {
      db.run('ROLLBACK');
    } catch {
      // Ignore rollback failures.
    }
    throw error;
  } finally {
    db.run('PRAGMA foreign_keys = ON');
  }
}

export function runMigrations(): void {
  ensureMigrationsTable();

  const migrations = loadMigrations();
  const applied = new Set(
    db.query<{ version: number }, []>('SELECT version FROM _migrations')
      .all()
      .map(r => r.version)
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    console.log(`Applying migration ${migration.version}: ${migration.name}`);
    if (migration.version === 3) {
      applyV3Migration(migration);
      continue;
    }

    applyStandardMigration(migration);
  }
}
