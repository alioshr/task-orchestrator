import { queryOne, queryAll, execute, generateId, now, buildSearchVector, loadTags, saveTags, deleteTags, ok, err, buildPaginationClause, countTasksByProject, countFeaturesByProject, type TaskCounts } from './base';
import type { Project, Result } from '../domain/types';
import { NotFoundError, ConflictError, ValidationError, EntityType } from '../domain/types';
import { transaction } from '../db/client';

interface ProjectRow {
  id: string;
  name: string;
  summary: string;
  description: string | null;
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
  tags?: string[];
}): Result<Project> {
  try {
    if (!params.name.trim()) {
      throw new ValidationError('Project name cannot be empty');
    }
    if (!params.summary.trim()) {
      throw new ValidationError('Project summary cannot be empty');
    }

    const result = transaction(() => {
      const id = generateId();
      const timestamp = now();
      const searchVector = buildSearchVector(params.name, params.summary, params.description);

      execute(
        `INSERT INTO projects (id, name, summary, description, version, created_at, modified_at, search_vector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, params.name, params.summary, params.description ?? null, 1, timestamp, timestamp, searchVector]
      );

      if (params.tags && params.tags.length > 0) {
        saveTags(id, 'PROJECT', params.tags);
      }

      const tags = params.tags && params.tags.length > 0 ? loadTags(id, 'PROJECT') : [];

      return rowToProject({
        id,
        name: params.name,
        summary: params.summary,
        description: params.description ?? null,
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
    tags?: string[];
    version: number;
  }
): Result<Project> {
  try {
    if (params.name !== undefined && !params.name.trim()) {
      throw new ValidationError('Project name cannot be empty');
    }
    if (params.summary !== undefined && !params.summary.trim()) {
      throw new ValidationError('Project summary cannot be empty');
    }

    const result = transaction(() => {
      const existing = queryOne<ProjectRow>(
        'SELECT * FROM projects WHERE id = ?',
        [id]
      );

      if (!existing) {
        throw new NotFoundError('Project', id);
      }

      if (existing.version !== params.version) {
        throw new ConflictError(
          `Version mismatch: expected ${params.version}, got ${existing.version}`
        );
      }

      const name = params.name ?? existing.name;
      const summary = params.summary ?? existing.summary;
      const description = params.description !== undefined ? params.description : existing.description;
      const newVersion = existing.version + 1;
      const modifiedAt = now();
      const searchVector = buildSearchVector(name, summary, description ?? undefined);

      execute(
        `UPDATE projects
         SET name = ?, summary = ?, description = ?, version = ?, modified_at = ?, search_vector = ?
         WHERE id = ?`,
        [name, summary, description, newVersion, modifiedAt, searchVector, id]
      );

      if (params.tags !== undefined) {
        saveTags(id, 'PROJECT', params.tags);
      }

      const tags = loadTags(id, 'PROJECT');

      return rowToProject({
        id: existing.id,
        name,
        summary,
        description,
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

    const existing = queryOne<ProjectRow>(
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );

    if (!existing) {
      throw new NotFoundError('Project', id);
    }

    const featureCount = countFeaturesByProject(id);
    const taskCounts = countTasksByProject(id);
    const taskCount = taskCounts.total;

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
        const featureIds = queryAll<{ id: string }>(
          'SELECT id FROM features WHERE project_id = ?',
          [id]
        );

        const taskIds = queryAll<{ id: string }>(
          `SELECT id FROM tasks WHERE project_id = ?
           OR feature_id IN (SELECT id FROM features WHERE project_id = ?)`,
          [id, id]
        );

        for (const task of taskIds) {
          execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.TASK, task.id]);
          deleteTags(task.id, EntityType.TASK);
        }

        execute(
          `DELETE FROM tasks WHERE project_id = ?
           OR feature_id IN (SELECT id FROM features WHERE project_id = ?)`,
          [id, id]
        );

        for (const feature of featureIds) {
          execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.FEATURE, feature.id]);
          deleteTags(feature.id, EntityType.FEATURE);
        }

        execute('DELETE FROM features WHERE project_id = ?', [id]);
      }

      execute('DELETE FROM sections WHERE entity_type = ? AND entity_id = ?', [EntityType.PROJECT, id]);
      deleteTags(id, EntityType.PROJECT);
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
  tags?: string;
  limit?: number;
  offset?: number;
}): Result<Project[]> {
  try {
    const whereClauses: string[] = [];
    const queryParams: any[] = [];

    if (params.query) {
      whereClauses.push('search_vector LIKE ?');
      queryParams.push(`%${params.query.toLowerCase()}%`);
    }

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
    const projectResult = getProject(id);
    if (!projectResult.success) {
      throw new NotFoundError('Project', id);
    }

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
