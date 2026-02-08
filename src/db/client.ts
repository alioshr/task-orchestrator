import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';

function resolveDbPath(): string {
  const home = process.env.TASK_ORCHESTRATOR_HOME || join(process.env.HOME || '~', '.task-orchestrator');
  return join(home, 'tasks.db');
}

const DB_PATH = resolveDbPath();

function applyPragmas(connection: Database): void {
  connection.run('PRAGMA journal_mode = WAL');
  connection.run('PRAGMA busy_timeout = 5000');
  connection.run('PRAGMA foreign_keys = ON');
  connection.run('PRAGMA synchronous = NORMAL');
}

function openDatabase(): Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const connection = new Database(DB_PATH);
  applyPragmas(connection);
  return connection;
}

export let db = openDatabase();

export function closeDbConnection(): void {
  db.close();
}

export function reopenDbConnection(): void {
  db = openDatabase();
}

// Transaction helper
export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

// UUID helper - generates a random UUID v4 as hex string (no dashes)
export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Timestamp helper
export function now(): string {
  return new Date().toISOString();
}
