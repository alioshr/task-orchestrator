import {
  db,
  generateId,
  now,
  queryOne,
  queryAll,
  execute,
  ok,
  err,
  buildSearchVector,
  loadTags,
  saveTags,
  deleteTags,
  buildPaginationClause,
} from './base';
import type { Result, Task } from '../domain/types';
import { TaskStatus, Priority, LockStatus, EntityType, ValidationError } from '../domain/types';
import { isValidTransition, getAllowedTransitions, isTerminalStatus } from '../services/status-validator';

// ============================================================================
// Row Mapping
// ============================================================================

interface TaskRow {
  id: string;
  project_id: string | null;
  feature_id: string | null;
  title: string;
  summary: string;
  description: string | null;
  status: string;
  priority: string;
  complexity: number;
  version: number;
  last_modified_by: string | null;
  lock_status: string;
  created_at: string;
  modified_at: string;
  search_vector: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    featureId: row.feature_id ?? undefined,
    title: row.title,
    summary: row.summary,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    complexity: row.complexity,
    version: row.version,
    lastModifiedBy: row.last_modified_by ?? undefined,
    lockStatus: row.lock_status as LockStatus,
    createdAt: new Date(row.created_at),
    modifiedAt: new Date(row.modified_at),
    searchVector: row.search_vector ?? undefined,
    tags: loadTags(row.id, EntityType.TASK),
  };
}

// ============================================================================
// Validation
// ============================================================================

function validateComplexity(complexity: number): boolean {
  return Number.isInteger(complexity) && complexity >= 1 && complexity <= 10;
}

// ============================================================================
// Repository Functions
// ============================================================================

export function createTask(params: {
  featureId?: string;
  title: string;
  summary: string;
  description?: string;
  status?: TaskStatus;
  priority: Priority;
  complexity: number;
  tags?: string[];
}): Result<Task> {
  try {
    // Validate complexity
    if (!validateComplexity(params.complexity)) {
      return err('Complexity must be an integer between 1 and 10', 'VALIDATION_ERROR');
    }

    // Validate required fields
    if (!params.title?.trim()) {
      return err('Title is required', 'VALIDATION_ERROR');
    }
    if (!params.summary?.trim()) {
      return err('Summary is required', 'VALIDATION_ERROR');
    }

    // Derive projectId from feature - feature is the source of truth for project membership
    let projectId: string | undefined;
    if (params.featureId) {
      const feature = queryOne<{ project_id: string | null }>(
        'SELECT project_id FROM features WHERE id = ?',
        [params.featureId]
      );
      if (!feature) {
        return err(`Feature not found: ${params.featureId}`, 'NOT_FOUND');
      }
      projectId = feature.project_id ?? undefined;
    }

    const id = generateId();
    const timestamp = now();
    const status = params.status ?? TaskStatus.PENDING;
    const searchVector = buildSearchVector(params.title, params.summary, params.description);

    db.run('BEGIN TRANSACTION');

    try {
      execute(
        `INSERT INTO tasks (
          id, project_id, feature_id, title, summary, description,
          status, priority, complexity, version, last_modified_by,
          lock_status, created_at, modified_at, search_vector
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          projectId ?? null,
          params.featureId ?? null,
          params.title.trim(),
          params.summary.trim(),
          params.description?.trim() ?? null,
          status,
          params.priority,
          params.complexity,
          1, // version
          null, // last_modified_by
          LockStatus.UNLOCKED,
          timestamp,
          timestamp,
          searchVector,
        ]
      );

      // Save tags if provided
      if (params.tags && params.tags.length > 0) {
        saveTags(id, EntityType.TASK, params.tags);
      }

      db.run('COMMIT');

      const row = queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
      if (!row) {
        return err('Failed to create task', 'INTERNAL_ERROR');
      }

      return ok(rowToTask(row));
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function getTask(id: string): Result<Task> {
  try {
    const row = queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);

    if (!row) {
      return err(`Task not found: ${id}`, 'NOT_FOUND');
    }

    return ok(rowToTask(row));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function updateTask(
  id: string,
  params: {
    title?: string;
    summary?: string;
    description?: string;
    status?: TaskStatus;
    priority?: Priority;
    complexity?: number;
    projectId?: string;
    featureId?: string;
    lastModifiedBy?: string;
    tags?: string[];
    version: number;
  }
): Result<Task> {
  try {
    // Validate complexity if provided
    if (params.complexity !== undefined && !validateComplexity(params.complexity)) {
      return err('Complexity must be an integer between 1 and 10', 'VALIDATION_ERROR');
    }

    // Check if task exists and version matches (optimistic locking)
    const existing = queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing) {
      return err(`Task not found: ${id}`, 'NOT_FOUND');
    }

    if (existing.version !== params.version) {
      return err(
        `Version conflict: expected ${params.version}, got ${existing.version}`,
        'CONFLICT'
      );
    }

    db.run('BEGIN TRANSACTION');

    try {
      // Validate status transition if status is being changed
      if (params.status !== undefined && params.status !== existing.status) {
        const currentStatus = existing.status;

        // Check if current status is terminal
        if (isTerminalStatus('task', currentStatus)) {
          db.run('ROLLBACK');
          return err(
            `Invalid status transition: no transitions are allowed from terminal status '${currentStatus}'`,
            'VALIDATION_ERROR'
          );
        }

        // Check if the transition is valid
        if (!isValidTransition('task', currentStatus, params.status)) {
          const allowed = getAllowedTransitions('task', currentStatus);
          db.run('ROLLBACK');
          return err(
            `Invalid status transition from '${currentStatus}' to '${params.status}'. Allowed transitions: ${allowed.join(', ')}`,
            'VALIDATION_ERROR'
          );
        }
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (params.title !== undefined) {
        if (!params.title.trim()) {
          db.run('ROLLBACK');
          return err('Title cannot be empty', 'VALIDATION_ERROR');
        }
        updates.push('title = ?');
        values.push(params.title.trim());
      }

      if (params.summary !== undefined) {
        if (!params.summary.trim()) {
          db.run('ROLLBACK');
          return err('Summary cannot be empty', 'VALIDATION_ERROR');
        }
        updates.push('summary = ?');
        values.push(params.summary.trim());
      }

      if (params.description !== undefined) {
        updates.push('description = ?');
        values.push(params.description?.trim() ?? null);
      }

      if (params.status !== undefined) {
        updates.push('status = ?');
        values.push(params.status);
      }

      if (params.priority !== undefined) {
        updates.push('priority = ?');
        values.push(params.priority);
      }

      if (params.complexity !== undefined) {
        updates.push('complexity = ?');
        values.push(params.complexity);
      }

      if (params.projectId !== undefined) {
        updates.push('project_id = ?');
        values.push(params.projectId ?? null);
      }

      if (params.featureId !== undefined) {
        updates.push('feature_id = ?');
        values.push(params.featureId ?? null);
      }

      if (params.lastModifiedBy !== undefined) {
        updates.push('last_modified_by = ?');
        values.push(params.lastModifiedBy ?? null);
      }

      // Update search vector if any searchable field changed
      if (params.title !== undefined || params.summary !== undefined || params.description !== undefined) {
        const title = params.title ?? existing.title;
        const summary = params.summary ?? existing.summary;
        const description = params.description !== undefined ? params.description : existing.description;
        updates.push('search_vector = ?');
        values.push(buildSearchVector(title, summary, description));
      }

      // Always update version and modified_at
      updates.push('version = version + 1');
      updates.push('modified_at = ?');
      values.push(now());

      // Add id to WHERE clause
      values.push(id);
      values.push(params.version);

      const sql = `UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND version = ?`;
      const changes = execute(sql, values);

      if (changes === 0) {
        db.run('ROLLBACK');
        return err('Update failed: version conflict', 'CONFLICT');
      }

      // Update tags if provided
      if (params.tags !== undefined) {
        saveTags(id, EntityType.TASK, params.tags);
      }

      db.run('COMMIT');

      const updated = queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
      if (!updated) {
        return err('Failed to retrieve updated task', 'INTERNAL_ERROR');
      }

      return ok(rowToTask(updated));
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function deleteTask(id: string): Result<boolean> {
  try {
    // Check if task exists
    const existing = queryOne<TaskRow>('SELECT id FROM tasks WHERE id = ?', [id]);
    if (!existing) {
      return err(`Task not found: ${id}`, 'NOT_FOUND');
    }

    db.run('BEGIN TRANSACTION');

    try {
      // Delete related dependencies
      execute('DELETE FROM dependencies WHERE from_task_id = ? OR to_task_id = ?', [id, id]);

      // Delete related sections
      execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.TASK, id]);

      // Delete related tags
      deleteTags(id, EntityType.TASK);

      // Delete the task
      execute('DELETE FROM tasks WHERE id = ?', [id]);

      db.run('COMMIT');

      return ok(true);
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function searchTasks(params: {
  query?: string;
  status?: string;
  priority?: string;
  projectId?: string;
  featureId?: string;
  tags?: string;
  limit?: number;
  offset?: number;
}): Result<Task[]> {
  try {
    const conditions: string[] = [];
    const values: any[] = [];

    // Text search
    if (params.query?.trim()) {
      conditions.push('search_vector LIKE ?');
      values.push(`%${params.query.toLowerCase()}%`);
    }

    // Status filter (supports multi-value and negation)
    if (params.status) {
      const statusFilters = params.status.split(',').map(s => s.trim());
      const negated = statusFilters.filter(s => s.startsWith('!'));
      const positive = statusFilters.filter(s => !s.startsWith('!'));

      if (positive.length > 0) {
        conditions.push(`status IN (${positive.map(() => '?').join(', ')})`);
        values.push(...positive);
      }

      if (negated.length > 0) {
        const negatedValues = negated.map(s => s.substring(1));
        conditions.push(`status NOT IN (${negatedValues.map(() => '?').join(', ')})`);
        values.push(...negatedValues);
      }
    }

    // Priority filter (supports multi-value and negation)
    if (params.priority) {
      const priorityFilters = params.priority.split(',').map(p => p.trim());
      const negated = priorityFilters.filter(p => p.startsWith('!'));
      const positive = priorityFilters.filter(p => !p.startsWith('!'));

      if (positive.length > 0) {
        conditions.push(`priority IN (${positive.map(() => '?').join(', ')})`);
        values.push(...positive);
      }

      if (negated.length > 0) {
        const negatedValues = negated.map(p => p.substring(1));
        conditions.push(`priority NOT IN (${negatedValues.map(() => '?').join(', ')})`);
        values.push(...negatedValues);
      }
    }

    // Project filter
    if (params.projectId) {
      conditions.push('project_id = ?');
      values.push(params.projectId);
    }

    // Feature filter
    if (params.featureId) {
      conditions.push('feature_id = ?');
      values.push(params.featureId);
    }

    // Tags filter (supports multi-value and negation)
    if (params.tags) {
      const tagFilters = params.tags.split(',').map(t => t.trim().toLowerCase());
      const negated = tagFilters.filter(t => t.startsWith('!'));
      const positive = tagFilters.filter(t => !t.startsWith('!'));

      if (positive.length > 0) {
        conditions.push(
          `id IN (SELECT entity_id FROM entity_tags WHERE entity_type = '${EntityType.TASK}' AND tag IN (${positive.map(() => '?').join(', ')}))`
        );
        values.push(...positive);
      }

      if (negated.length > 0) {
        const negatedValues = negated.map(t => t.substring(1));
        conditions.push(
          `id NOT IN (SELECT entity_id FROM entity_tags WHERE entity_type = '${EntityType.TASK}' AND tag IN (${negatedValues.map(() => '?').join(', ')}))`
        );
        values.push(...negatedValues);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const paginationClause = buildPaginationClause({ limit: params.limit, offset: params.offset });

    const sql = `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC${paginationClause}`;
    const rows = queryAll<TaskRow>(sql, values);

    return ok(rows.map(rowToTask));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function setTaskStatus(id: string, status: TaskStatus, version: number): Result<Task> {
  try {
    // Check if task exists and version matches
    const existing = queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing) {
      return err(`Task not found: ${id}`, 'NOT_FOUND');
    }

    if (existing.version !== version) {
      return err(
        `Version conflict: expected ${version}, got ${existing.version}`,
        'CONFLICT'
      );
    }

    // Validate status transition if status is being changed
    if (status !== existing.status) {
      // Check if current status is terminal
      if (isTerminalStatus('task', existing.status)) {
        return err(
          `Cannot transition from terminal status ${existing.status}`,
          'VALIDATION_ERROR'
        );
      }

      // Check if the transition is valid
      if (!isValidTransition('task', existing.status, status)) {
        const allowed = getAllowedTransitions('task', existing.status);
        return err(
          `Invalid status transition from ${existing.status} to ${status}. Allowed transitions: ${allowed.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }
    }

    const changes = execute(
      'UPDATE tasks SET status = ?, version = version + 1, modified_at = ? WHERE id = ? AND version = ?',
      [status, now(), id, version]
    );

    if (changes === 0) {
      return err('Update failed: version conflict', 'CONFLICT');
    }

    const updated = queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!updated) {
      return err('Failed to retrieve updated task', 'INTERNAL_ERROR');
    }

    return ok(rowToTask(updated));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function bulkUpdateTasks(
  ids: string[],
  updates: {
    status?: TaskStatus;
    priority?: Priority;
  }
): Result<number> {
  try {
    if (ids.length === 0) {
      return ok(0);
    }

    if (!updates.status && !updates.priority) {
      return err('At least one update field (status or priority) must be provided', 'VALIDATION_ERROR');
    }

    db.run('BEGIN TRANSACTION');

    try {
      const updateFields: string[] = [];
      const values: any[] = [];

      if (updates.status !== undefined) {
        updateFields.push('status = ?');
        values.push(updates.status);
      }

      if (updates.priority !== undefined) {
        updateFields.push('priority = ?');
        values.push(updates.priority);
      }

      // Always update version and modified_at
      updateFields.push('version = version + 1');
      updateFields.push('modified_at = ?');
      values.push(now());

      // Add ids to WHERE clause
      const placeholders = ids.map(() => '?').join(', ');
      values.push(...ids);

      const sql = `UPDATE tasks SET ${updateFields.join(', ')} WHERE id IN (${placeholders})`;
      const changes = execute(sql, values);

      db.run('COMMIT');

      return ok(changes);
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}
