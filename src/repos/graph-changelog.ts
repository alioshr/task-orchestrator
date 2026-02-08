import {
  queryOne,
  queryAll,
  execute,
  generateId,
  now,
  ok,
  err,
  buildPaginationClause,
} from './base';
import type { Result } from '../domain/types';

// ============================================================================
// Row / Domain Types
// ============================================================================

interface ChangelogRow {
  id: string;
  parent_type: string;
  parent_id: string;
  task_id: string;
  summary: string;
  created_at: string;
}

export interface ChangelogEntry {
  id: string;
  parentType: 'atom' | 'molecule';
  parentId: string;
  taskId: string;
  summary: string;
  createdAt: string;
}

// ============================================================================
// Mapping
// ============================================================================

function rowToEntry(row: ChangelogRow): ChangelogEntry {
  return {
    id: row.id,
    parentType: row.parent_type as 'atom' | 'molecule',
    parentId: row.parent_id,
    taskId: row.task_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Repository Functions
// ============================================================================

export function appendChangelog(params: {
  parentType: 'atom' | 'molecule';
  parentId: string;
  taskId: string;
  summary: string;
}): Result<ChangelogEntry> {
  try {
    // Validate summary
    if (!params.summary || !params.summary.trim()) {
      return err('Changelog summary cannot be empty', 'VALIDATION_ERROR');
    }
    if (params.summary.length > 4096) {
      return err('Changelog summary must be 4KB or less', 'VALIDATION_ERROR');
    }

    // Validate parent exists
    if (params.parentType === 'atom') {
      const atom = queryOne<{ id: string }>('SELECT id FROM graph_atoms WHERE id = ?', [params.parentId]);
      if (!atom) {
        return err(`Atom not found: ${params.parentId}`, 'NOT_FOUND');
      }
    } else {
      const molecule = queryOne<{ id: string }>('SELECT id FROM graph_molecules WHERE id = ?', [params.parentId]);
      if (!molecule) {
        return err(`Molecule not found: ${params.parentId}`, 'NOT_FOUND');
      }
    }

    // Validate taskId references an existing task
    const task = queryOne<{ id: string }>('SELECT id FROM tasks WHERE id = ?', [params.taskId]);
    if (!task) {
      return err(`Task not found: ${params.taskId}`, 'NOT_FOUND');
    }

    const id = generateId();
    const timestamp = now();

    execute(
      `INSERT INTO graph_changelog (id, parent_type, parent_id, task_id, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, params.parentType, params.parentId, params.taskId, params.summary.trim(), timestamp]
    );

    const row = queryOne<ChangelogRow>('SELECT * FROM graph_changelog WHERE id = ?', [id]);
    if (!row) {
      return err('Failed to create changelog entry', 'INTERNAL_ERROR');
    }

    return ok(rowToEntry(row));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function searchChangelog(params: {
  parentType: 'atom' | 'molecule';
  parentId: string;
  limit?: number;
  offset?: number;
}): Result<ChangelogEntry[]> {
  try {
    const paginationClause = buildPaginationClause({ limit: params.limit, offset: params.offset });

    const sql = `SELECT * FROM graph_changelog WHERE parent_type = ? AND parent_id = ? ORDER BY created_at DESC${paginationClause}`;
    const rows = queryAll<ChangelogRow>(sql, [params.parentType, params.parentId]);

    return ok(rows.map(rowToEntry));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

/**
 * Get the last N changelog entries for an entity (used for inline inclusion in get responses).
 */
export function getRecentChangelog(
  parentType: 'atom' | 'molecule',
  parentId: string,
  limit: number = 5
): ChangelogEntry[] {
  try {
    const rows = queryAll<ChangelogRow>(
      `SELECT * FROM graph_changelog WHERE parent_type = ? AND parent_id = ? ORDER BY created_at DESC LIMIT ?`,
      [parentType, parentId, limit]
    );
    return rows.map(rowToEntry);
  } catch {
    return [];
  }
}
