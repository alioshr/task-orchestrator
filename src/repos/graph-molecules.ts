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
import { transaction } from '../db/client';
import type { Result } from '../domain/types';

// ============================================================================
// Row / Domain Types
// ============================================================================

interface MoleculeRow {
  id: string;
  project_id: string;
  name: string;
  knowledge: string;
  related_molecules: string;
  created_by_task_id: string;
  last_task_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Molecule {
  id: string;
  projectId: string;
  name: string;
  knowledge: string;
  relatedMolecules: Array<{ moleculeId: string; reason: string }>;
  createdByTaskId: string;
  lastTaskId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Mapping
// ============================================================================

function parseRelatedMolecules(json: string): Array<{ moleculeId: string; reason: string }> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToMolecule(row: MoleculeRow): Molecule {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    knowledge: row.knowledge,
    relatedMolecules: parseRelatedMolecules(row.related_molecules),
    createdByTaskId: row.created_by_task_id,
    lastTaskId: row.last_task_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Repository Functions
// ============================================================================

export function createMolecule(params: {
  projectId: string;
  name: string;
  knowledge?: string;
  relatedMolecules?: string;
  createdByTaskId: string;
}): Result<Molecule> {
  try {
    // Validate project exists
    const project = queryOne<{ id: string }>('SELECT id FROM projects WHERE id = ?', [params.projectId]);
    if (!project) {
      return err(`Project not found: ${params.projectId}`, 'NOT_FOUND');
    }

    // Validate name
    if (!params.name || !params.name.trim()) {
      return err('Molecule name cannot be empty', 'VALIDATION_ERROR');
    }
    if (params.name.length > 255) {
      return err('Molecule name must be 255 characters or less', 'VALIDATION_ERROR');
    }

    // Validate knowledge size
    const knowledge = params.knowledge?.trim() ?? '';
    if (knowledge.length > 32768) {
      return err('Knowledge must be 32KB or less', 'VALIDATION_ERROR');
    }

    // Validate relatedMolecules
    let relatedMolecules = '[]';
    if (params.relatedMolecules) {
      try {
        const parsed = JSON.parse(params.relatedMolecules);
        if (!Array.isArray(parsed)) {
          return err('relatedMolecules must be a JSON array', 'VALIDATION_ERROR');
        }
        if (parsed.length > 50) {
          return err('relatedMolecules must have 50 entries or less', 'VALIDATION_ERROR');
        }
        relatedMolecules = params.relatedMolecules;
      } catch {
        return err('relatedMolecules must be valid JSON', 'VALIDATION_ERROR');
      }
    }

    // Validate createdByTaskId references an existing task
    const task = queryOne<{ id: string }>('SELECT id FROM tasks WHERE id = ?', [params.createdByTaskId]);
    if (!task) {
      return err(`Task not found: ${params.createdByTaskId}`, 'NOT_FOUND');
    }

    const id = generateId();
    const timestamp = now();

    execute(
      `INSERT INTO graph_molecules (id, project_id, name, knowledge, related_molecules, created_by_task_id, last_task_id, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, params.projectId, params.name.trim(), knowledge, relatedMolecules, params.createdByTaskId, params.createdByTaskId, timestamp, timestamp]
    );

    const row = queryOne<MoleculeRow>('SELECT * FROM graph_molecules WHERE id = ?', [id]);
    if (!row) {
      return err('Failed to create molecule', 'INTERNAL_ERROR');
    }

    return ok(rowToMolecule(row));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function getMolecule(id: string): Result<Molecule> {
  try {
    const row = queryOne<MoleculeRow>('SELECT * FROM graph_molecules WHERE id = ?', [id]);
    if (!row) {
      return err(`Molecule not found: ${id}`, 'NOT_FOUND');
    }
    return ok(rowToMolecule(row));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function updateMolecule(
  id: string,
  params: {
    name?: string;
    knowledge?: string;
    knowledgeMode?: 'overwrite' | 'append';
    relatedMolecules?: string;
    lastTaskId?: string;
    version: number;
  }
): Result<Molecule> {
  try {
    const result = transaction(() => {
      const existing = queryOne<MoleculeRow>('SELECT * FROM graph_molecules WHERE id = ?', [id]);
      if (!existing) {
        return { error: `Molecule not found: ${id}`, code: 'NOT_FOUND' };
      }

      if (existing.version !== params.version) {
        return {
          error: `Version conflict: expected ${params.version}, current version is ${existing.version}`,
          code: 'CONFLICT',
          currentVersion: existing.version,
        };
      }

      // Validate name
      if (params.name !== undefined) {
        if (!params.name.trim()) {
          return { error: 'Molecule name cannot be empty', code: 'VALIDATION_ERROR' };
        }
        if (params.name.length > 255) {
          return { error: 'Molecule name must be 255 characters or less', code: 'VALIDATION_ERROR' };
        }
      }

      // Build knowledge value
      let knowledgeValue = existing.knowledge;
      if (params.knowledge !== undefined) {
        const mode = params.knowledgeMode ?? 'overwrite';
        if (mode === 'append') {
          const timestamp = new Date().toISOString();
          const taskRef = params.lastTaskId ? ` task:${params.lastTaskId}` : '';
          const separator = `\n\n---[${timestamp}${taskRef}]---\n`;
          knowledgeValue = existing.knowledge + separator + params.knowledge;
        } else {
          knowledgeValue = params.knowledge.trim();
        }
        if (knowledgeValue.length > 32768) {
          return { error: 'Knowledge must be 32KB or less', code: 'VALIDATION_ERROR' };
        }
      }

      // Validate relatedMolecules
      let relatedMolecules = existing.related_molecules;
      if (params.relatedMolecules !== undefined) {
        try {
          const parsed = JSON.parse(params.relatedMolecules);
          if (!Array.isArray(parsed)) {
            return { error: 'relatedMolecules must be a JSON array', code: 'VALIDATION_ERROR' };
          }
          if (parsed.length > 50) {
            return { error: 'relatedMolecules must have 50 entries or less', code: 'VALIDATION_ERROR' };
          }
          relatedMolecules = params.relatedMolecules;
        } catch {
          return { error: 'relatedMolecules must be valid JSON', code: 'VALIDATION_ERROR' };
        }
      }

      const name = params.name?.trim() ?? existing.name;
      const lastTaskId = params.lastTaskId ?? existing.last_task_id;
      const updatedAt = now();

      execute(
        `UPDATE graph_molecules SET name = ?, knowledge = ?, related_molecules = ?, last_task_id = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [name, knowledgeValue, relatedMolecules, lastTaskId, updatedAt, id]
      );

      const updated = queryOne<MoleculeRow>('SELECT * FROM graph_molecules WHERE id = ?', [id]);
      if (!updated) {
        return { error: 'Failed to retrieve updated molecule', code: 'INTERNAL_ERROR' };
      }

      return { success: true as const, data: rowToMolecule(updated) };
    });

    if ('error' in result) {
      return err(result.error as string, result.code as string);
    }

    return ok(result.data);
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function deleteMolecule(
  id: string,
  params: {
    version: number;
    cascade?: boolean;
    lastTaskId?: string;
  }
): Result<boolean> {
  try {
    const result = transaction(() => {
      const existing = queryOne<MoleculeRow>('SELECT * FROM graph_molecules WHERE id = ?', [id]);
      if (!existing) {
        return { error: `Molecule not found: ${id}`, code: 'NOT_FOUND' };
      }

      if (existing.version !== params.version) {
        return {
          error: `Version conflict: expected ${params.version}, current version is ${existing.version}`,
          code: 'CONFLICT',
          currentVersion: existing.version,
        };
      }

      if (params.cascade) {
        // Delete changelog entries for member atoms
        const atomIds = queryAll<{ id: string }>('SELECT id FROM graph_atoms WHERE molecule_id = ?', [id]);
        for (const atom of atomIds) {
          execute("DELETE FROM graph_changelog WHERE parent_type = 'atom' AND parent_id = ?", [atom.id]);
        }
        // Delete member atoms
        execute('DELETE FROM graph_atoms WHERE molecule_id = ?', [id]);
      } else {
        // Orphan member atoms
        const timestamp = now();
        const lastTaskId = params.lastTaskId ?? existing.last_task_id;
        execute(
          'UPDATE graph_atoms SET molecule_id = NULL, last_task_id = ?, updated_at = ? WHERE molecule_id = ?',
          [lastTaskId, timestamp, id]
        );
      }

      // Delete molecule's changelog entries
      execute("DELETE FROM graph_changelog WHERE parent_type = 'molecule' AND parent_id = ?", [id]);

      // Delete the molecule
      execute('DELETE FROM graph_molecules WHERE id = ?', [id]);

      return { success: true as const };
    });

    if ('error' in result) {
      return err(result.error as string, result.code as string);
    }

    return ok(true);
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function searchMolecules(params: {
  projectId: string;
  query?: string;
  limit?: number;
  offset?: number;
}): Result<Molecule[]> {
  try {
    const conditions: string[] = ['project_id = ?'];
    const values: any[] = [params.projectId];

    if (params.query?.trim()) {
      conditions.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(knowledge) LIKE ? ESCAPE '\\')");
      const escaped = params.query.toLowerCase().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const q = `%${escaped}%`;
      values.push(q, q);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const paginationClause = buildPaginationClause({ limit: params.limit, offset: params.offset });

    const sql = `SELECT * FROM graph_molecules ${whereClause} ORDER BY name ASC${paginationClause}`;
    const rows = queryAll<MoleculeRow>(sql, values);

    return ok(rows.map(rowToMolecule));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}
