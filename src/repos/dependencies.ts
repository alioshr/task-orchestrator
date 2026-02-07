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
import type { Result, Dependency, DependencyType, DependencyEntityType, Task, Feature } from '../domain/types';
import { ValidationError, NotFoundError, ConflictError } from '../domain/types';

// ============================================================================
// Helper: Circular Dependency Detection
// ============================================================================

/**
 * Check if adding a dependency would create a circular dependency.
 * Uses BFS to traverse the dependency graph from toEntityId following BLOCKS dependencies.
 * If we reach fromEntityId, it means adding fromEntityId -> toEntityId would create a cycle.
 */
function hasCircularDependency(fromEntityId: string, toEntityId: string, entityType: DependencyEntityType): boolean {
  const visited = new Set<string>();
  const queue = [toEntityId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === fromEntityId) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const deps = queryAll<{ to_entity_id: string }>(
      "SELECT to_entity_id FROM dependencies WHERE from_entity_id = ? AND type = 'BLOCKS' AND entity_type = ?",
      [current, entityType]
    );

    for (const dep of deps) {
      queue.push(dep.to_entity_id);
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
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    entityType: row.entity_type as DependencyEntityType,
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

/** Map database row to Feature domain object */
function mapRowToFeature(row: any): Feature {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    name: row.name,
    summary: row.summary,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    version: row.version,
    createdAt: toDate(row.created_at),
    modifiedAt: toDate(row.modified_at)
  };
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Create a new dependency between two entities of the same type.
 *
 * Validates:
 * - fromEntityId != toEntityId (no self-dependency)
 * - Both entities exist
 * - No circular dependencies (if A blocks B, B cannot block A)
 * - No duplicate dependencies
 */
export function createDependency(params: {
  fromEntityId: string;
  toEntityId: string;
  type: DependencyType;
  entityType: DependencyEntityType;
}): Result<Dependency> {
  const { fromEntityId, toEntityId, type, entityType } = params;

  // Validate: no self-dependency
  if (fromEntityId === toEntityId) {
    return err('Cannot create a dependency from an entity to itself', 'SELF_DEPENDENCY');
  }

  // Validate: both entities exist
  const table = entityType === 'task' ? 'tasks' : 'features';
  const fromEntity = queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ?`,
    [fromEntityId]
  );

  if (!fromEntity) {
    return err(`${entityType} not found: ${fromEntityId}`, 'NOT_FOUND');
  }

  const toEntity = queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ?`,
    [toEntityId]
  );

  if (!toEntity) {
    return err(`${entityType} not found: ${toEntityId}`, 'NOT_FOUND');
  }

  // Validate: no circular dependencies for BLOCKS and IS_BLOCKED_BY types
  const isCircular = type === 'BLOCKS'
    ? hasCircularDependency(fromEntityId, toEntityId, entityType)
    : type === 'IS_BLOCKED_BY'
    ? hasCircularDependency(toEntityId, fromEntityId, entityType)
    : false;

  if (isCircular) {
    return err(
      'Cannot create dependency: would create a circular dependency',
      'CIRCULAR_DEPENDENCY'
    );
  }

  // Check for duplicate
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM dependencies WHERE from_entity_id = ? AND to_entity_id = ? AND type = ? AND entity_type = ?',
    [fromEntityId, toEntityId, type, entityType]
  );

  if (existing) {
    return err(
      'Dependency already exists between these entities with this type',
      'DUPLICATE_DEPENDENCY'
    );
  }

  // Create dependency
  const id = generateId();
  const createdAt = now();

  try {
    execute(
      'INSERT INTO dependencies (id, from_entity_id, to_entity_id, entity_type, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, fromEntityId, toEntityId, entityType, type, createdAt]
    );

    const dependency: Dependency = {
      id,
      fromEntityId,
      toEntityId,
      entityType,
      type,
      createdAt: toDate(createdAt)
    };

    return ok(dependency);
  } catch (error: any) {
    return err(`Failed to create dependency: ${error.message}`, 'CREATE_FAILED');
  }
}

/**
 * Get dependencies for an entity.
 *
 * @param entityId - The entity ID to query
 * @param direction - Filter by direction:
 *   - 'dependencies': entities that this entity depends on (from_entity_id = entityId)
 *   - 'dependents': entities that depend on this entity (to_entity_id = entityId)
 *   - 'both': union of above (default)
 * @param entityType - Optional filter by entity type
 */
export function getDependencies(
  entityId: string,
  direction: 'dependencies' | 'dependents' | 'both' = 'both',
  entityType?: DependencyEntityType
): Result<Dependency[]> {
  try {
    let dependencies: Dependency[] = [];
    const typeFilter = entityType ? ' AND entity_type = ?' : '';
    const typeParam = entityType ? [entityType] : [];

    if (direction === 'dependencies' || direction === 'both') {
      const rows = queryAll<any>(
        `SELECT * FROM dependencies WHERE from_entity_id = ?${typeFilter} ORDER BY created_at`,
        [entityId, ...typeParam]
      );
      dependencies.push(...rows.map(mapRowToDependency));
    }

    if (direction === 'dependents' || direction === 'both') {
      const rows = queryAll<any>(
        `SELECT * FROM dependencies WHERE to_entity_id = ?${typeFilter} ORDER BY created_at`,
        [entityId, ...typeParam]
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
 * Get all blocked entities of a given type.
 *
 * Returns entities that either:
 * - Have status = 'BLOCKED', OR
 * - Have incomplete blocking dependencies (blockers that are not completed/resolved)
 *
 * @param params - Entity type and optional filters
 */
export function getBlocked(params: {
  entityType: DependencyEntityType;
  projectId?: string;
  featureId?: string;
}): Result<(Task | Feature)[]> {
  try {
    const { entityType } = params;

    if (entityType === 'task') {
      let sql = `
        SELECT DISTINCT t.*
        FROM tasks t
        WHERE (
          t.status = 'BLOCKED'
          OR EXISTS (
            SELECT 1
            FROM dependencies d
            JOIN tasks blocker ON blocker.id = d.from_entity_id
            WHERE d.to_entity_id = t.id
              AND d.type = 'BLOCKS'
              AND d.entity_type = 'task'
              AND blocker.status NOT IN ('COMPLETED', 'CANCELLED')
          )
        )
      `;

      const sqlParams: string[] = [];

      if (params.projectId) {
        sql += ' AND t.project_id = ?';
        sqlParams.push(params.projectId);
      }

      if (params.featureId) {
        sql += ' AND t.feature_id = ?';
        sqlParams.push(params.featureId);
      }

      sql += `
        ORDER BY
          CASE t.priority
            WHEN 'HIGH' THEN 1
            WHEN 'MEDIUM' THEN 2
            WHEN 'LOW' THEN 3
          END,
          t.created_at ASC
      `;

      const rows = queryAll<any>(sql, sqlParams);
      return ok(rows.map(mapRowToTask));
    } else {
      let sql = `
        SELECT DISTINCT f.*
        FROM features f
        WHERE (
          f.status = 'BLOCKED'
          OR EXISTS (
            SELECT 1
            FROM dependencies d
            JOIN features blocker ON blocker.id = d.from_entity_id
            WHERE d.to_entity_id = f.id
              AND d.type = 'BLOCKS'
              AND d.entity_type = 'feature'
              AND blocker.status NOT IN ('COMPLETED', 'ARCHIVED')
          )
        )
      `;

      const sqlParams: string[] = [];

      if (params.projectId) {
        sql += ' AND f.project_id = ?';
        sqlParams.push(params.projectId);
      }

      sql += `
        ORDER BY
          CASE f.priority
            WHEN 'HIGH' THEN 1
            WHEN 'MEDIUM' THEN 2
            WHEN 'LOW' THEN 3
          END,
          f.created_at ASC
      `;

      const rows = queryAll<any>(sql, sqlParams);
      return ok(rows.map(mapRowToFeature));
    }
  } catch (error: any) {
    return err(`Failed to get blocked entities: ${error.message}`, 'QUERY_FAILED');
  }
}

/**
 * Get the next entity to work on.
 *
 * For tasks: returns the highest priority PENDING task with no incomplete blockers.
 * Ordered by priority, complexity (simpler first), then creation time.
 *
 * For features: returns the highest priority DRAFT/PLANNING feature with no incomplete blockers.
 * Ordered by priority, then creation time.
 *
 * @param params - Entity type, optional filters, and priority preference
 */
export function getNext(params: {
  entityType: DependencyEntityType;
  projectId?: string;
  featureId?: string;
  priority?: string;
}): Result<Task | Feature | null> {
  try {
    const { entityType } = params;

    if (entityType === 'task') {
      let sql = `
        SELECT t.*
        FROM tasks t
        WHERE t.status = 'PENDING'
          AND NOT EXISTS (
            SELECT 1
            FROM dependencies d
            JOIN tasks blocker ON blocker.id = d.from_entity_id
            WHERE d.to_entity_id = t.id
              AND d.type = 'BLOCKS'
              AND d.entity_type = 'task'
              AND blocker.status NOT IN ('COMPLETED', 'CANCELLED')
          )
      `;

      const sqlParams: string[] = [];

      if (params.projectId) {
        sql += ' AND t.project_id = ?';
        sqlParams.push(params.projectId);
      }

      if (params.featureId) {
        sql += ' AND t.feature_id = ?';
        sqlParams.push(params.featureId);
      }

      if (params.priority) {
        sql += ' AND t.priority = ?';
        sqlParams.push(params.priority);
      }

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
      return ok(row ? mapRowToTask(row) : null);
    } else {
      let sql = `
        SELECT f.*
        FROM features f
        WHERE f.status IN ('DRAFT', 'PLANNING')
          AND NOT EXISTS (
            SELECT 1
            FROM dependencies d
            JOIN features blocker ON blocker.id = d.from_entity_id
            WHERE d.to_entity_id = f.id
              AND d.type = 'BLOCKS'
              AND d.entity_type = 'feature'
              AND blocker.status NOT IN ('COMPLETED', 'ARCHIVED')
          )
      `;

      const sqlParams: string[] = [];

      if (params.projectId) {
        sql += ' AND f.project_id = ?';
        sqlParams.push(params.projectId);
      }

      if (params.priority) {
        sql += ' AND f.priority = ?';
        sqlParams.push(params.priority);
      }

      sql += `
        ORDER BY
          CASE f.priority
            WHEN 'HIGH' THEN 1
            WHEN 'MEDIUM' THEN 2
            WHEN 'LOW' THEN 3
          END,
          f.created_at ASC
        LIMIT 1
      `;

      const row = queryOne<any>(sql, sqlParams);
      return ok(row ? mapRowToFeature(row) : null);
    }
  } catch (error: any) {
    return err(`Failed to get next entity: ${error.message}`, 'QUERY_FAILED');
  }
}
