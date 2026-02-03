import { db, generateId, now } from '../db/client';
import type { Result } from '../domain/types';
import { NotFoundError, ValidationError, ConflictError } from '../domain/types';

// Re-export for convenience
export { db, generateId, now };

// --- Query helpers ---

/** Get a single row by query, or null */
export function queryOne<T>(sql: string, params: any[] = []): T | null {
  return db.query<T, any[]>(sql).get(...params) ?? null;
}

/** Get all rows matching query */
export function queryAll<T>(sql: string, params: any[] = []): T[] {
  return db.query<T, any[]>(sql).all(...params);
}

/** Execute a write statement, return changes count */
export function execute(sql: string, params: any[] = []): number {
  const result = db.run(sql, params);
  return result.changes;
}

// --- UUID helpers ---

/** Convert hex string ID to the format used in queries */
export function toId(hex: string): string {
  return hex;
}

// --- Timestamp helpers ---

/** Parse ISO timestamp string to Date */
export function toDate(ts: string): Date {
  return new Date(ts);
}

/** Format Date to ISO string for storage */
export function toTimestamp(date: Date): string {
  return date.toISOString();
}

// --- Search vector builder ---

/** Build a search vector from text fields for LIKE-based searching */
export function buildSearchVector(...fields: (string | undefined | null)[]): string {
  return fields
    .filter(Boolean)
    .map(f => f!.toLowerCase())
    .join(' ');
}

// --- Tag helpers (entity_tags table) ---

/** Load tags for an entity */
export function loadTags(entityId: string, entityType: string): string[] {
  const rows = queryAll<{ tag: string }>(
    'SELECT tag FROM entity_tags WHERE entity_id = ? AND entity_type = ?',
    [entityId, entityType]
  );
  return rows.map(r => r.tag);
}

/** Save tags for an entity (replaces existing) */
export function saveTags(entityId: string, entityType: string, tags: string[]): void {
  execute('DELETE FROM entity_tags WHERE entity_id = ? AND entity_type = ?', [entityId, entityType]);
  for (const tag of tags) {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) continue;
    execute(
      'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
      [generateId(), entityId, entityType, normalizedTag, now()]
    );
  }
}

/** Delete all tags for an entity */
export function deleteTags(entityId: string, entityType: string): void {
  execute('DELETE FROM entity_tags WHERE entity_id = ? AND entity_type = ?', [entityId, entityType]);
}

// --- Result helpers ---

/** Wrap a value in a success result */
export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

/** Wrap an error in a failure result */
export function err<T>(error: string, code?: string): Result<T> {
  return { success: false, error, code };
}

// --- Pagination helper ---

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export function buildPaginationClause(params: PaginationParams): string {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  return ` LIMIT ${limit} OFFSET ${offset}`;
}

// --- Count helper ---

export interface TaskCounts {
  total: number;
  byStatus: Record<string, number>;
}

export function countTasksByFeature(featureId: string): TaskCounts {
  const rows = queryAll<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM tasks WHERE feature_id = ? GROUP BY status',
    [featureId]
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byStatus[row.status] = row.count;
    total += row.count;
  }
  return { total, byStatus };
}

export function countTasksByProject(projectId: string): TaskCounts {
  const rows = queryAll<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status',
    [projectId]
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byStatus[row.status] = row.count;
    total += row.count;
  }
  return { total, byStatus };
}
