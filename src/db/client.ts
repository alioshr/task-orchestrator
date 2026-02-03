import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DATABASE_PATH || 'data/tasks.db';

// Ensure directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Set pragmas for performance and correctness
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA busy_timeout = 5000');
db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA synchronous = NORMAL');

// Transaction helper
export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

// UUID helper - generates a random UUID v4 as hex string (no dashes)
export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Timestamp helper
export function now(): string {
  return new Date().toISOString();
}
