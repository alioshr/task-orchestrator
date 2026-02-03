import {
  db,
  generateId,
  now,
  queryOne,
  queryAll,
  execute,
  ok,
  err,
  toDate
} from './base';
import type { Result, Dependency, DependencyType, Task } from '../domain/types';
import { ValidationError, NotFoundError, ConflictError } from '../domain/types';

// ============================================================================
// Helper: Circular Dependency Detection
// ============================================================================

/**
 * Check if adding a dependency would create a circular dependency.
 * Uses BFS to traverse the dependency graph from toTaskId following BLOCKS dependencies.
 * If we reach fromTaskId, it means adding fromTaskId -> toTaskId would create a cycle.
 */
function hasCircularDependency(fromTaskId: string, toTaskId: string): boolean {
  const visited = new Set<string>();
  const queue = [toTaskId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === fromTaskId) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    // Follow BLOCKS dependencies from current task
    const deps = queryAll<{ to_task_id: string }>(
      "SELECT to_task_id FROM dependencies WHERE from_task_id = ? AND type = 'BLOCKS'",
      [current]
    );

    for (const dep of deps) {
      queue.push(dep.to_task_id);
    }
  }

  return false;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/** Map database row to Dependency domain object */
function mapRowToDependency(row: any): Dependency {
  return {
    id: row.id,
    fromTaskId: row.from_task_id,
    toTaskId: row.to_task_id,
    type: row.type as DependencyType,
    createdAt: toDate(row.created_at)
  };
}

/** Map database row to Task domain object */
function mapRowToTask(row: any): Task {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    featureId: row.feature_id ?? undefined,
    title: row.title,
    summary: row.summary,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    complexity: row.complexity,
    version: row.version,
    lastModifiedBy: row.last_modified_by ?? undefined,
    lockStatus: row.lock_status,
    createdAt: toDate(row.created_at),
    modifiedAt: toDate(row.modified_at)
  };
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Create a new dependency between two tasks.
 *
 * Validates:
 * - fromTaskId != toTaskId (no self-dependency)
 * - Both tasks exist
 * - No circular dependencies (if A blocks B, B cannot block A)
 * - No duplicate dependencies
 */
export function createDependency(params: {
  fromTaskId: string;
  toTaskId: string;
  type: DependencyType;
}): Result<Dependency> {
  const { fromTaskId, toTaskId, type } = params;

  // Validate: no self-dependency
  if (fromTaskId === toTaskId) {
    return err('Cannot create a dependency from a task to itself', 'SELF_DEPENDENCY');
  }

  // Validate: both tasks exist
  const fromTask = queryOne<{ id: string }>(
    'SELECT id FROM tasks WHERE id = ?',
    [fromTaskId]
  );

  if (!fromTask) {
    return err(`Task not found: ${fromTaskId}`, 'NOT_FOUND');
  }

  const toTask = queryOne<{ id: string }>(
    'SELECT id FROM tasks WHERE id = ?',
    [toTaskId]
  );

  if (!toTask) {
    return err(`Task not found: ${toTaskId}`, 'NOT_FOUND');
  }

  // Validate: no circular dependencies for BLOCKS type
  if (type === 'BLOCKS' && hasCircularDependency(fromTaskId, toTaskId)) {
    return err(
      'Cannot create dependency: would create a circular dependency',
      'CIRCULAR_DEPENDENCY'
    );
  }

  // Check for duplicate
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM dependencies WHERE from_task_id = ? AND to_task_id = ? AND type = ?',
    [fromTaskId, toTaskId, type]
  );

  if (existing) {
    return err(
      'Dependency already exists between these tasks with this type',
      'DUPLICATE_DEPENDENCY'
    );
  }

  // Create dependency
  const id = generateId();
  const createdAt = now();

  try {
    execute(
      'INSERT INTO dependencies (id, from_task_id, to_task_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, fromTaskId, toTaskId, type, createdAt]
    );

    const dependency: Dependency = {
      id,
      fromTaskId,
      toTaskId,
      type,
      createdAt: toDate(createdAt)
    };

    return ok(dependency);
  } catch (error: any) {
    return err(`Failed to create dependency: ${error.message}`, 'CREATE_FAILED');
  }
}

/**
 * Get dependencies for a task.
 *
 * @param taskId - The task ID to query
 * @param direction - Filter by direction:
 *   - 'dependencies': tasks that this task depends on (from_task_id = taskId)
 *   - 'dependents': tasks that depend on this task (to_task_id = taskId)
 *   - 'both': union of above (default)
 */
export function getDependencies(
  taskId: string,
  direction: 'dependencies' | 'dependents' | 'both' = 'both'
): Result<Dependency[]> {
  try {
    let dependencies: Dependency[] = [];

    if (direction === 'dependencies' || direction === 'both') {
      const rows = queryAll<any>(
        'SELECT * FROM dependencies WHERE from_task_id = ? ORDER BY created_at',
        [taskId]
      );
      dependencies.push(...rows.map(mapRowToDependency));
    }

    if (direction === 'dependents' || direction === 'both') {
      const rows = queryAll<any>(
        'SELECT * FROM dependencies WHERE to_task_id = ? ORDER BY created_at',
        [taskId]
      );
      dependencies.push(...rows.map(mapRowToDependency));
    }

    return ok(dependencies);
  } catch (error: any) {
    return err(`Failed to get dependencies: ${error.message}`, 'QUERY_FAILED');
  }
}

/**
 * Delete a dependency by ID.
 */
export function deleteDependency(id: string): Result<boolean> {
  try {
    const changes = execute('DELETE FROM dependencies WHERE id = ?', [id]);

    if (changes === 0) {
      return err(`Dependency not found: ${id}`, 'NOT_FOUND');
    }

    return ok(true);
  } catch (error: any) {
    return err(`Failed to delete dependency: ${error.message}`, 'DELETE_FAILED');
  }
}

/**
 * Get all blocked tasks.
 *
 * Returns tasks that either:
 * - Have status = 'BLOCKED', OR
 * - Have incomplete blocking dependencies (tasks that block them but are not completed)
 *
 * @param params - Optional filters for projectId and/or featureId
 */
export function getBlockedTasks(params?: {
  projectId?: string;
  featureId?: string;
}): Result<Task[]> {
  try {
    let sql = `
      SELECT DISTINCT t.*
      FROM tasks t
      WHERE (
        t.status = 'BLOCKED'
        OR EXISTS (
          SELECT 1
          FROM dependencies d
          JOIN tasks blocker ON blocker.id = d.from_task_id
          WHERE d.to_task_id = t.id
            AND d.type = 'BLOCKS'
            AND blocker.status NOT IN ('COMPLETED', 'CANCELLED')
        )
      )
    `;

    const sqlParams: string[] = [];

    if (params?.projectId) {
      sql += ' AND t.project_id = ?';
      sqlParams.push(params.projectId);
    }

    if (params?.featureId) {
      sql += ' AND t.feature_id = ?';
      sqlParams.push(params.featureId);
    }

    sql += ' ORDER BY t.priority DESC, t.created_at ASC';

    const rows = queryAll<any>(sql, sqlParams);
    const tasks = rows.map(mapRowToTask);

    return ok(tasks);
  } catch (error: any) {
    return err(`Failed to get blocked tasks: ${error.message}`, 'QUERY_FAILED');
  }
}

/**
 * Get the next task to work on.
 *
 * Returns the highest priority PENDING task that has no incomplete blocking dependencies.
 * Considers priority and complexity.
 *
 * @param params - Optional filters and priority preference
 */
export function getNextTask(params?: {
  projectId?: string;
  featureId?: string;
  priority?: string;
}): Result<Task | null> {
  try {
    let sql = `
      SELECT t.*
      FROM tasks t
      WHERE t.status = 'PENDING'
        AND NOT EXISTS (
          SELECT 1
          FROM dependencies d
          JOIN tasks blocker ON blocker.id = d.from_task_id
          WHERE d.to_task_id = t.id
            AND d.type = 'BLOCKS'
            AND blocker.status NOT IN ('COMPLETED', 'CANCELLED')
        )
    `;

    const sqlParams: string[] = [];

    if (params?.projectId) {
      sql += ' AND t.project_id = ?';
      sqlParams.push(params.projectId);
    }

    if (params?.featureId) {
      sql += ' AND t.feature_id = ?';
      sqlParams.push(params.featureId);
    }

    if (params?.priority) {
      sql += ' AND t.priority = ?';
      sqlParams.push(params.priority);
    }

    // Order by priority (HIGH > MEDIUM > LOW), then by complexity (simpler first), then by creation time
    sql += `
      ORDER BY
        CASE t.priority
          WHEN 'HIGH' THEN 1
          WHEN 'MEDIUM' THEN 2
          WHEN 'LOW' THEN 3
        END,
        t.complexity ASC,
        t.created_at ASC
      LIMIT 1
    `;

    const row = queryOne<any>(sql, sqlParams);

    if (!row) {
      return ok(null);
    }

    const task = mapRowToTask(row);
    return ok(task);
  } catch (error: any) {
    return err(`Failed to get next task: ${error.message}`, 'QUERY_FAILED');
  }
}
