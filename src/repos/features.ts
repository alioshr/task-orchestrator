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
import type { Result, Feature, Priority } from '../domain/types';
import { NotFoundError, ValidationError, ConflictError, EntityType } from '../domain/types';

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
  blocked_by: string;
  blocked_reason: string | null;
  related_to: string;
  version: number;
  created_at: string;
  modified_at: string;
  search_vector: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
    status: row.status,
    priority: row.priority as Priority,
    blockedBy: parseJsonArray(row.blocked_by),
    blockedReason: row.blocked_reason ?? undefined,
    relatedTo: parseJsonArray(row.related_to),
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

export function createFeature(params: {
  projectId?: string;
  name: string;
  summary: string;
  description?: string;
  status?: string;
  priority: Priority;
  tags?: string[];
}): Result<Feature> {
  try {
    validateFeatureParams({
      name: params.name,
      summary: params.summary,
    });

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
      const status = params.status ?? 'NEW';
      const searchVector = buildSearchVector(params.name, params.summary, params.description);

      execute(
        `INSERT INTO features (
          id, project_id, name, summary, description, status, priority,
          blocked_by, blocked_reason, related_to,
          version, created_at, modified_at, search_vector
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.projectId ?? null,
          params.name,
          params.summary,
          params.description ?? null,
          status,
          params.priority,
          '[]', // blocked_by
          null, // blocked_reason
          '[]', // related_to
          1,
          timestamp,
          timestamp,
          searchVector
        ]
      );

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

export function updateFeature(
  id: string,
  params: {
    name?: string;
    summary?: string;
    description?: string;
    priority?: Priority;
    projectId?: string;
    tags?: string[];
    relatedTo?: string[];
    version: number;
  }
): Result<Feature> {
  try {
    validateFeatureParams({
      name: params.name,
      summary: params.summary,
    });

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
      const current = queryOne<FeatureRow>('SELECT * FROM features WHERE id = ?', [id]);

      if (!current) {
        throw new NotFoundError('Feature', id);
      }

      if (current.version !== params.version) {
        throw new ConflictError(
          `Version conflict: expected ${params.version}, found ${current.version}`
        );
      }

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
      if (params.priority !== undefined) {
        updates.push('priority = ?');
        values.push(params.priority);
      }
      if (params.projectId !== undefined) {
        updates.push('project_id = ?');
        values.push(params.projectId);
      }
      if (params.relatedTo !== undefined) {
        updates.push('related_to = ?');
        values.push(JSON.stringify(params.relatedTo));
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

      updates.push('version = ?');
      values.push(params.version + 1);

      const timestamp = now();
      updates.push('modified_at = ?');
      values.push(timestamp);

      values.push(id);
      values.push(params.version);

      execute(
        `UPDATE features SET ${updates.join(', ')} WHERE id = ? AND version = ?`,
        values
      );

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

export function deleteFeature(id: string, options?: { cascade?: boolean }): Result<boolean> {
  try {
    const cascade = options?.cascade ?? false;

    const exists = queryOne<{ id: string }>('SELECT id FROM features WHERE id = ?', [id]);

    if (!exists) {
      throw new NotFoundError('Feature', id);
    }

    const taskCounts = countTasksByFeature(id);
    const taskCount = taskCounts.total;

    if (taskCount > 0 && !cascade) {
      return err(
        `Cannot delete feature: contains ${taskCount} task${taskCount > 1 ? 's' : ''}. Use cascade: true to delete all.`,
        'HAS_CHILDREN'
      );
    }

    const result = transaction(() => {
      if (cascade) {
        const taskIds = queryAll<{ id: string }>(
          'SELECT id FROM tasks WHERE feature_id = ?',
          [id]
        );

        for (const task of taskIds) {
          execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.TASK, task.id]);
          deleteTags(task.id, EntityType.TASK);
        }

        execute('DELETE FROM tasks WHERE feature_id = ?', [id]);
      }

      execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.FEATURE, id]);
      deleteTags(id, EntityType.FEATURE);
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

    if (params.query) {
      conditions.push('search_vector LIKE ?');
      values.push(`%${params.query.toLowerCase()}%`);
    }

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

    if (params.projectId) {
      conditions.push('project_id = ?');
      values.push(params.projectId);
    }

    if (params.tags) {
      const tagList = params.tags.split(',').map(t => t.trim().toLowerCase());
      conditions.push(`id IN (
        SELECT entity_id FROM entity_tags
        WHERE entity_type = ? AND tag IN (${tagList.map(() => '?').join(', ')})
      )`);
      values.push(EntityType.FEATURE, ...tagList);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const paginationClause = buildPaginationClause({
      limit: params.limit,
      offset: params.offset
    });

    const sql = `SELECT * FROM features ${whereClause} ORDER BY created_at DESC${paginationClause}`;
    const rows = queryAll<FeatureRow>(sql, values);

    const features = rows.map(row => {
      const tags = loadTags(row.id, EntityType.FEATURE);
      return rowToFeature(row, tags);
    });

    return ok(features);
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

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
