import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { runMigrations } from './db/migrate';
import { db } from './db/client';

// Run safe migrations (001-002), then apply v3 schema migration for tests.
// Migration 003 is excluded from auto-run to protect production data,
// but test databases are always fresh so it's safe to apply here.
runMigrations();

const migrationsDir = join(dirname(import.meta.path), 'db', 'migrations');
const v3Sql = readFileSync(join(migrationsDir, '003_v3_pipeline_refactor.sql'), 'utf-8');
db.run('PRAGMA foreign_keys = OFF');
db.run(v3Sql);
db.run(`INSERT INTO _migrations (version, name, applied_at) VALUES (3, '003_v3_pipeline_refactor.sql', '${new Date().toISOString()}')`);
db.run('PRAGMA foreign_keys = ON');
