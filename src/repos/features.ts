import {
  queryOne,
  queryAll,
  execute,
  generateId,
  now,
  loadTags,
  saveTags,
  deleteTags,
  ok,
  err,
  buildSearchVector,
  buildPaginationClause,
  countTasksByFeature,
  type TaskCounts
} from './base';
import { transaction } from '../db/client';
import type { Result, Feature, FeatureStatus, Priority } from '../domain/types';
import { NotFoundError, ValidationError, ConflictError, EntityType } from '../domain/types';
import { isValidTransition, getAllowedTransitions, isTerminalStatus } from '../services/status-validator';

// ============================================================================
// Database Row Types
// ============================================================================

interface FeatureRow {
  id: string;
  project_id: string | null;
  name: string;
  summary: string;
  description: string | null;
  status: string;
  priority: string;
  version: number;
  created_at: string;
  modified_at: string;
  search_vector: string | null;
}

// ============================================================================
// Mappers
// ============================================================================

function rowToFeature(row: FeatureRow, tags?: string[]): Feature {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    name: row.name,
    summary: row.summary,
    description: row.description ?? undefined,
    status: row.status as FeatureStatus,
    priority: row.priority as Priority,
    version: row.version,
    createdAt: new Date(row.created_at),
    modifiedAt: new Date(row.modified_at),
    searchVector: row.search_vector ?? undefined,
    tags: tags ?? []
  };
}

// ============================================================================
// Validation
// ============================================================================

function validateFeatureParams(params: {
  name?: string;
  summary?: string;
  status?: FeatureStatus;
  priority?: Priority;
}): void {
  if (params.name !== undefined && params.name.trim().length === 0) {
    throw new ValidationError('Feature name cannot be empty');
  }
  if (params.summary !== undefined && params.summary.trim().length === 0) {
    throw new ValidationError('Feature summary cannot be empty');
  }
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Create a new feature
 */
export function createFeature(params: {
  projectId?: string;
  name: string;
  summary: string;
  description?: string;
  status?: FeatureStatus;
  priority: Priority;
  tags?: string[];
}): Result<Feature> {
  try {
    validateFeatureParams({
      name: params.name,
      summary: params.summary,
      status: params.status,
      priority: params.priority
    });

    // Validate project exists if provided
    if (params.projectId) {
      const projectExists = queryOne<{ id: string }>(
        'SELECT id FROM projects WHERE id = ?',
        [params.projectId]
      );
      if (!projectExists) {
        throw new ValidationError(`Project not found: ${params.projectId}`);
      }
    }

    const feature = transaction(() => {
      const id = generateId();
      const timestamp = now();
      const status = params.status ?? 'DRAFT';
      const searchVector = buildSearchVector(params.name, params.summary, params.description);

      execute(
        `INSERT INTO features (
          id, project_id, name, summary, description, status, priority,
          version, created_at, modified_at, search_vector
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.projectId ?? null,
          params.name,
          params.summary,
          params.description ?? null,
          status,
          params.priority,
          1,
          timestamp,
          timestamp,
          searchVector
        ]
      );

      // Save tags if provided
      if (params.tags && params.tags.length > 0) {
        saveTags(id, EntityType.FEATURE, params.tags);
      }

      const row = queryOne<FeatureRow>('SELECT * FROM features WHERE id = ?', [id]);
      if (!row) {
        throw new Error('Failed to retrieve created feature');
      }

      const tags = loadTags(id, EntityType.FEATURE);
      return rowToFeature(row, tags);
    });

    return ok(feature);
  } catch (error) {
    if (error instanceof ValidationError) {
      return err(error.message, 'VALIDATION_ERROR');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

/**
 * Get a feature by ID
 */
export function getFeature(id: string): Result<Feature> {
  try {
    const row = queryOne<FeatureRow>('SELECT * FROM features WHERE id = ?', [id]);

    if (!row) {
      throw new NotFoundError('Feature', id);
    }

    const tags = loadTags(id, EntityType.FEATURE);
    const feature = rowToFeature(row, tags);

    return ok(feature);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return err(error.message, 'NOT_FOUND');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

/**
 * Update a feature (with optimistic locking)
 */
export function updateFeature(
  id: string,
  params: {
    name?: string;
    summary?: string;
    description?: string;
    status?: FeatureStatus;
    priority?: Priority;
    projectId?: string;
    tags?: string[];
    version: number;
  }
): Result<Feature> {
  try {
    validateFeatureParams({
      name: params.name,
      summary: params.summary,
      status: params.status,
      priority: params.priority
    });

    // Validate project exists if provided
    if (params.projectId !== undefined) {
      if (params.projectId !== null) {
        const projectExists = queryOne<{ id: string }>(
          'SELECT id FROM projects WHERE id = ?',
          [params.projectId]
        );
        if (!projectExists) {
          throw new ValidationError(`Project not found: ${params.projectId}`);
        }
      }
    }

    const feature = transaction(() => {
      // Check if feature exists and version matches
      const current = queryOne<FeatureRow>('SELECT * FROM features WHERE id = ?', [id]);

      if (!current) {
        throw new NotFoundError('Feature', id);
      }

      if (current.version !== params.version) {
        throw new ConflictError(
          `Version conflict: expected ${params.version}, found ${current.version}`
        );
      }

      // Validate status transition if status is being updated
      if (params.status !== undefined && params.status !== current.status) {
        const currentStatus = current.status;

        // Check if current status is terminal
        if (isTerminalStatus('feature', currentStatus)) {
          throw new ValidationError(
            `Cannot transition from terminal status '${currentStatus}'`
          );
        }

        // Check if the transition is valid
        if (!isValidTransition('feature', currentStatus, params.status)) {
          const allowed = getAllowedTransitions('feature', currentStatus);
          throw new ValidationError(
            `Invalid status transition from '${currentStatus}' to '${params.status}'. Allowed transitions: ${allowed.join(', ')}`
          );
        }
      }

      // Build update query dynamically based on provided params
      const updates: string[] = [];
      const values: any[] = [];

      if (params.name !== undefined) {
        updates.push('name = ?');
        values.push(params.name);
      }
      if (params.summary !== undefined) {
        updates.push('summary = ?');
        values.push(params.summary);
      }
      if (params.description !== undefined) {
        updates.push('description = ?');
        values.push(params.description);
      }
      if (params.status !== undefined) {
        updates.push('status = ?');
        values.push(params.status);
      }
      if (params.priority !== undefined) {
        updates.push('priority = ?');
        values.push(params.priority);
      }
      if (params.projectId !== undefined) {
        updates.push('project_id = ?');
        values.push(params.projectId);
      }

      // Update search vector if any text field changed
      if (params.name !== undefined || params.summary !== undefined || params.description !== undefined) {
        const searchVector = buildSearchVector(
          params.name ?? current.name,
          params.summary ?? current.summary,
          params.description !== undefined ? params.description : current.description
        );
        updates.push('search_vector = ?');
        values.push(searchVector);
      }

      // Always update version and modified_at
      updates.push('version = ?');
      values.push(params.version + 1);

      const timestamp = now();
      updates.push('modified_at = ?');
      values.push(timestamp);

      // Add WHERE clause params
      values.push(id);
      values.push(params.version);

      execute(
        `UPDATE features SET ${updates.join(', ')} WHERE id = ? AND version = ?`,
        values
      );

      // Update tags if provided
      if (params.tags !== undefined) {
        saveTags(id, EntityType.FEATURE, params.tags);
      }

      const row = queryOne<FeatureRow>('SELECT * FROM features WHERE id = ?', [id]);
      if (!row) {
        throw new Error('Failed to retrieve updated feature');
      }

      const tags = loadTags(id, EntityType.FEATURE);
      return rowToFeature(row, tags);
    });

    return ok(feature);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return err(error.message, 'NOT_FOUND');
    }
    if (error instanceof ValidationError) {
      return err(error.message, 'VALIDATION_ERROR');
    }
    if (error instanceof ConflictError) {
      return err(error.message, 'CONFLICT');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

/**
 * Delete a feature
 */
export function deleteFeature(id: string, options?: { cascade?: boolean }): Result<boolean> {
  try {
    const cascade = options?.cascade ?? false;

    // Check if feature exists
    const exists = queryOne<{ id: string }>('SELECT id FROM features WHERE id = ?', [id]);

    if (!exists) {
      throw new NotFoundError('Feature', id);
    }

    // Count children
    const taskCounts = countTasksByFeature(id);
    const taskCount = taskCounts.total;

    // If children exist and no cascade, return error with counts
    if (taskCount > 0 && !cascade) {
      return err(
        `Cannot delete feature: contains ${taskCount} task${taskCount > 1 ? 's' : ''}. Use cascade: true to delete all.`,
        'HAS_CHILDREN'
      );
    }

    const result = transaction(() => {
      if (cascade) {
        // Get all task IDs for this feature
        const taskIds = queryAll<{ id: string }>(
          'SELECT id FROM tasks WHERE feature_id = ?',
          [id]
        );

        // Delete each task's dependencies, sections, and tags
        for (const task of taskIds) {
          execute('DELETE FROM dependencies WHERE (from_entity_id = ? OR to_entity_id = ?) AND entity_type = ?', [task.id, task.id, 'task']);
          execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.TASK, task.id]);
          deleteTags(task.id, EntityType.TASK);
        }

        // Delete all tasks for this feature
        execute('DELETE FROM tasks WHERE feature_id = ?', [id]);
      }

      // Delete feature-level dependencies
      execute('DELETE FROM dependencies WHERE (from_entity_id = ? OR to_entity_id = ?) AND entity_type = ?', [id, id, 'feature']);

      // Delete feature sections
      execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.FEATURE, id]);

      // Delete associated tags
      deleteTags(id, EntityType.FEATURE);

      // Delete the feature
      const changes = execute('DELETE FROM features WHERE id = ?', [id]);

      return changes > 0;
    });

    return ok(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return err(error.message, 'NOT_FOUND');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

/**
 * Search features with flexible filtering
 */
export function searchFeatures(params: {
  query?: string;
  status?: string;
  priority?: string;
  projectId?: string;
  tags?: string;
  limit?: number;
  offset?: number;
}): Result<Feature[]> {
  try {
    const conditions: string[] = [];
    const values: any[] = [];

    // Text search via search_vector
    if (params.query) {
      conditions.push('search_vector LIKE ?');
      values.push(`%${params.query.toLowerCase()}%`);
    }

    // Status filter (supports multi-value and negation)
    if (params.status) {
      const statusFilters = params.status.split(',').map(s => s.trim());
      const negations: string[] = [];
      const inclusions: string[] = [];

      for (const filter of statusFilters) {
        if (filter.startsWith('!')) {
          negations.push(filter.substring(1));
        } else {
          inclusions.push(filter);
        }
      }

      if (inclusions.length > 0) {
        conditions.push(`status IN (${inclusions.map(() => '?').join(', ')})`);
        values.push(...inclusions);
      }

      if (negations.length > 0) {
        conditions.push(`status NOT IN (${negations.map(() => '?').join(', ')})`);
        values.push(...negations);
      }
    }

    // Priority filter (supports multi-value and negation)
    if (params.priority) {
      const priorityFilters = params.priority.split(',').map(p => p.trim());
      const negations: string[] = [];
      const inclusions: string[] = [];

      for (const filter of priorityFilters) {
        if (filter.startsWith('!')) {
          negations.push(filter.substring(1));
        } else {
          inclusions.push(filter);
        }
      }

      if (inclusions.length > 0) {
        conditions.push(`priority IN (${inclusions.map(() => '?').join(', ')})`);
        values.push(...inclusions);
      }

      if (negations.length > 0) {
        conditions.push(`priority NOT IN (${negations.map(() => '?').join(', ')})`);
        values.push(...negations);
      }
    }

    // Project filter
    if (params.projectId) {
      conditions.push('project_id = ?');
      values.push(params.projectId);
    }

    // Tags filter
    if (params.tags) {
      const tagList = params.tags.split(',').map(t => t.trim().toLowerCase());
      conditions.push(`id IN (
        SELECT entity_id FROM entity_tags
        WHERE entity_type = ? AND tag IN (${tagList.map(() => '?').join(', ')})
      )`);
      values.push(EntityType.FEATURE, ...tagList);
    }

    // Build query
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const paginationClause = buildPaginationClause({
      limit: params.limit,
      offset: params.offset
    });

    const sql = `SELECT * FROM features ${whereClause} ORDER BY created_at DESC${paginationClause}`;
    const rows = queryAll<FeatureRow>(sql, values);

    // Load tags for each feature
    const features = rows.map(row => {
      const tags = loadTags(row.id, EntityType.FEATURE);
      return rowToFeature(row, tags);
    });

    return ok(features);
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

/**
 * Get feature with task counts
 */
export function getFeatureOverview(id: string): Result<{
  feature: Feature;
  taskCounts: TaskCounts;
}> {
  try {
    const featureResult = getFeature(id);

    if (!featureResult.success) {
      return featureResult as Result<any>;
    }

    const taskCounts = countTasksByFeature(id);

    return ok({
      feature: featureResult.data,
      taskCounts
    });
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}
