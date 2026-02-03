import { db } from './client';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

// Create migrations tracking table
db.run(`
  CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`);

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const migrationsDir = join(dirname(import.meta.path), 'migrations');
  const files = ['001_initial_schema.sql'];

  return files.map((file, i) => ({
    version: i + 1,
    name: file,
    sql: readFileSync(join(migrationsDir, file), 'utf-8')
  }));
}

export function runMigrations(): void {
  const migrations = loadMigrations();
  const applied = new Set(
    db.query<{ version: number }, []>('SELECT version FROM _migrations')
      .all()
      .map(r => r.version)
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    console.log(`Applying migration ${migration.version}: ${migration.name}`);
    db.transaction(() => {
      db.run(migration.sql);
      db.run(
        'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, new Date().toISOString()]
      );
    })();
  }
}
