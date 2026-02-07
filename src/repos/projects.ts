import { queryOne, queryAll, execute, generateId, now, buildSearchVector, loadTags, saveTags, deleteTags, ok, err, buildPaginationClause, countTasksByProject, countFeaturesByProject, type TaskCounts } from './base';
import type { Project, Result } from '../domain/types';
import { ProjectStatus, NotFoundError, ConflictError, ValidationError, EntityType } from '../domain/types';
import { transaction } from '../db/client';
import { isValidTransition, getAllowedTransitions, isTerminalStatus } from '../services/status-validator';

interface ProjectRow {
  id: string;
  name: string;
  summary: string;
  description: string | null;
  status: string;
  version: number;
  created_at: string;
  modified_at: string;
  search_vector: string | null;
}

function rowToProject(row: ProjectRow, tags?: string[]): Project {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    description: row.description ?? undefined,
    status: row.status as ProjectStatus,
    version: row.version,
    createdAt: new Date(row.created_at),
    modifiedAt: new Date(row.modified_at),
    searchVector: row.search_vector ?? undefined,
    tags
  };
}

export function createProject(params: {
  name: string;
  summary: string;
  description?: string;
  status?: ProjectStatus;
  tags?: string[];
}): Result<Project> {
  try {
    // Validate name not empty
    if (!params.name.trim()) {
      throw new ValidationError('Project name cannot be empty');
    }
    if (!params.summary.trim()) {
      throw new ValidationError('Project summary cannot be empty');
    }

    const result = transaction(() => {
      const id = generateId();
      const timestamp = now();
      const status = params.status ?? ProjectStatus.PLANNING;
      const searchVector = buildSearchVector(params.name, params.summary, params.description);

      execute(
        `INSERT INTO projects (id, name, summary, description, status, version, created_at, modified_at, search_vector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, params.name, params.summary, params.description ?? null, status, 1, timestamp, timestamp, searchVector]
      );

      // Save tags if provided
      if (params.tags && params.tags.length > 0) {
        saveTags(id, 'PROJECT', params.tags);
      }

      const tags = params.tags && params.tags.length > 0 ? loadTags(id, 'PROJECT') : [];

      return rowToProject({
        id,
        name: params.name,
        summary: params.summary,
        description: params.description ?? null,
        status,
        version: 1,
        created_at: timestamp,
        modified_at: timestamp,
        search_vector: searchVector
      }, tags);
    });

    return ok(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return err(error.message, 'VALIDATION_ERROR');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'CREATE_FAILED');
  }
}

export function getProject(id: string): Result<Project> {
  try {
    const row = queryOne<ProjectRow>(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );

    if (!row) {
      throw new NotFoundError('Project', id);
    }

    const tags = loadTags(id, 'PROJECT');
    return ok(rowToProject(row, tags));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return err(error.message, 'NOT_FOUND');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'GET_FAILED');
  }
}

export function updateProject(
  id: string,
  params: {
    name?: string;
    summary?: string;
    description?: string;
    status?: ProjectStatus;
    tags?: string[];
    version: number;
  }
): Result<Project> {
  try {
    // Validate inputs
    if (params.name !== undefined && !params.name.trim()) {
      throw new ValidationError('Project name cannot be empty');
    }
    if (params.summary !== undefined && !params.summary.trim()) {
      throw new ValidationError('Project summary cannot be empty');
    }

    const result = transaction(() => {
      // Get existing project
      const existing = queryOne<ProjectRow>(
        'SELECT * FROM projects WHERE id = ?',
        [id]
      );

      if (!existing) {
        throw new NotFoundError('Project', id);
      }

      // Check version matches (optimistic locking)
      if (existing.version !== params.version) {
        throw new ConflictError(
          `Version mismatch: expected ${params.version}, got ${existing.version}`
        );
      }

      // Validate status transition if status is being changed
      if (params.status !== undefined && params.status !== existing.status) {
        const currentStatus = existing.status;
        const newStatus = params.status;

        // Check if current status is terminal
        if (isTerminalStatus('project', currentStatus)) {
          throw new ValidationError(
            `Cannot transition from terminal status '${currentStatus}'`
          );
        }

        // Check if transition is valid
        if (!isValidTransition('project', currentStatus, newStatus)) {
          const allowed = getAllowedTransitions('project', currentStatus);
          throw new ValidationError(
            `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowed.join(', ')}`
          );
        }
      }

      // Merge updated fields
      const name = params.name ?? existing.name;
      const summary = params.summary ?? existing.summary;
      const description = params.description !== undefined ? params.description : existing.description;
      const status = params.status ?? existing.status;
      const newVersion = existing.version + 1;
      const modifiedAt = now();

      // Rebuild search vector with updated fields
      const searchVector = buildSearchVector(name, summary, description ?? undefined);

      execute(
        `UPDATE projects
         SET name = ?, summary = ?, description = ?, status = ?, version = ?, modified_at = ?, search_vector = ?
         WHERE id = ?`,
        [name, summary, description, status, newVersion, modifiedAt, searchVector, id]
      );

      // Update tags if provided
      if (params.tags !== undefined) {
        saveTags(id, 'PROJECT', params.tags);
      }

      const tags = loadTags(id, 'PROJECT');

      return rowToProject({
        id: existing.id,
        name,
        summary,
        description,
        status,
        version: newVersion,
        created_at: existing.created_at,
        modified_at: modifiedAt,
        search_vector: searchVector
      }, tags);
    });

    return ok(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return err(error.message, 'NOT_FOUND');
    }
    if (error instanceof ConflictError) {
      return err(error.message, 'VERSION_CONFLICT');
    }
    if (error instanceof ValidationError) {
      return err(error.message, 'VALIDATION_ERROR');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'UPDATE_FAILED');
  }
}

export function deleteProject(id: string, options?: { cascade?: boolean }): Result<boolean> {
  try {
    const cascade = options?.cascade ?? false;

    // Check if project exists
    const existing = queryOne<ProjectRow>(
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );

    if (!existing) {
      throw new NotFoundError('Project', id);
    }

    // Count children
    const featureCount = countFeaturesByProject(id);
    const taskCounts = countTasksByProject(id);
    const taskCount = taskCounts.total;

    // If children exist and no cascade, return error with counts
    if ((featureCount > 0 || taskCount > 0) && !cascade) {
      const parts: string[] = [];
      if (featureCount > 0) parts.push(`${featureCount} feature${featureCount > 1 ? 's' : ''}`);
      if (taskCount > 0) parts.push(`${taskCount} task${taskCount > 1 ? 's' : ''}`);
      return err(
        `Cannot delete project: contains ${parts.join(' and ')}. Use cascade: true to delete all.`,
        'HAS_CHILDREN'
      );
    }

    const result = transaction(() => {
      if (cascade) {
        // Get all feature IDs for this project first (needed for task cleanup)
        const featureIds = queryAll<{ id: string }>(
          'SELECT id FROM features WHERE project_id = ?',
          [id]
        );

        // Get all task IDs: tasks directly under project OR under features of this project
        const taskIds = queryAll<{ id: string }>(
          `SELECT id FROM tasks WHERE project_id = ?
           OR feature_id IN (SELECT id FROM features WHERE project_id = ?)`,
          [id, id]
        );

        // Delete each task's dependencies, sections, and tags
        for (const task of taskIds) {
          execute('DELETE FROM dependencies WHERE (from_entity_id = ? OR to_entity_id = ?) AND entity_type = ?', [task.id, task.id, 'task']);
          execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.TASK, task.id]);
          deleteTags(task.id, EntityType.TASK);
        }

        // Delete all tasks: directly under project OR under features of this project
        execute(
          `DELETE FROM tasks WHERE project_id = ?
           OR feature_id IN (SELECT id FROM features WHERE project_id = ?)`,
          [id, id]
        );

        // Delete each feature's dependencies, sections, and tags
        for (const feature of featureIds) {
          execute('DELETE FROM dependencies WHERE (from_entity_id = ? OR to_entity_id = ?) AND entity_type = ?', [feature.id, feature.id, 'feature']);
          execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.FEATURE, feature.id]);
          deleteTags(feature.id, EntityType.FEATURE);
        }

        // Delete all features for this project
        execute('DELETE FROM features WHERE project_id = ?', [id]);
      }

      // Delete project sections
      execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.PROJECT, id]);

      // Delete project tags
      deleteTags(id, EntityType.PROJECT);

      // Delete project
      execute('DELETE FROM projects WHERE id = ?', [id]);

      return true;
    });

    return ok(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return err(error.message, 'NOT_FOUND');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'DELETE_FAILED');
  }
}

export function searchProjects(params: {
  query?: string;
  status?: string;
  tags?: string;
  limit?: number;
  offset?: number;
}): Result<Project[]> {
  try {
    const whereClauses: string[] = [];
    const queryParams: any[] = [];

    // Text search via search_vector LIKE
    if (params.query) {
      whereClauses.push('search_vector LIKE ?');
      queryParams.push(`%${params.query.toLowerCase()}%`);
    }

    // Status filter (supports multi-value "PLANNING,IN_DEVELOPMENT" and negation "!COMPLETED")
    if (params.status) {
      if (params.status.startsWith('!')) {
        // Negation
        const excludedStatus = params.status.substring(1);
        whereClauses.push('status != ?');
        queryParams.push(excludedStatus);
      } else if (params.status.includes(',')) {
        // Multi-value
        const statuses = params.status.split(',').map(s => s.trim());
        const placeholders = statuses.map(() => '?').join(',');
        whereClauses.push(`status IN (${placeholders})`);
        queryParams.push(...statuses);
      } else {
        // Single value
        whereClauses.push('status = ?');
        queryParams.push(params.status);
      }
    }

    // Tags filter via subquery on entity_tags
    if (params.tags) {
      const tags = params.tags.split(',').map(t => t.trim().toLowerCase());
      whereClauses.push(`
        id IN (
          SELECT entity_id FROM entity_tags
          WHERE entity_type = 'PROJECT' AND tag IN (${tags.map(() => '?').join(',')})
          GROUP BY entity_id
          HAVING COUNT(DISTINCT tag) = ?
        )
      `);
      queryParams.push(...tags, tags.length);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const paginationClause = buildPaginationClause({ limit: params.limit, offset: params.offset });

    const sql = `
      SELECT * FROM projects
      ${whereClause}
      ORDER BY modified_at DESC
      ${paginationClause}
    `;

    const rows = queryAll<ProjectRow>(sql, queryParams);

    // Load tags for each result
    const projects = rows.map(row => {
      const tags = loadTags(row.id, 'PROJECT');
      return rowToProject(row, tags);
    });

    return ok(projects);
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'SEARCH_FAILED');
  }
}

export function getProjectOverview(id: string): Result<{ project: Project; taskCounts: TaskCounts }> {
  try {
    // Get project
    const projectResult = getProject(id);
    if (!projectResult.success) {
      throw new NotFoundError('Project', id);
    }

    // Get task counts
    const taskCounts = countTasksByProject(id);

    return ok({
      project: projectResult.data,
      taskCounts
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return err(error.message, 'NOT_FOUND');
    }
    return err(error instanceof Error ? error.message : 'Unknown error', 'OVERVIEW_FAILED');
  }
}
