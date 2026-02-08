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

interface AtomRow {
  id: string;
  project_id: string;
  molecule_id: string | null;
  name: string;
  paths: string;
  knowledge: string;
  related_atoms: string;
  created_by_task_id: string;
  last_task_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Atom {
  id: string;
  projectId: string;
  moleculeId: string | null;
  name: string;
  paths: string[];
  knowledge: string;
  relatedAtoms: Array<{ atomId: string; reason: string }>;
  createdByTaskId: string;
  lastTaskId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Mapping
// ============================================================================

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRelatedAtoms(json: string): Array<{ atomId: string; reason: string }> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToAtom(row: AtomRow): Atom {
  return {
    id: row.id,
    projectId: row.project_id,
    moleculeId: row.molecule_id,
    name: row.name,
    paths: parseJsonArray(row.paths),
    knowledge: row.knowledge,
    relatedAtoms: parseRelatedAtoms(row.related_atoms),
    createdByTaskId: row.created_by_task_id,
    lastTaskId: row.last_task_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Path Pattern Validation
// ============================================================================

function validatePathPatterns(paths: string[]): string | null {
  if (paths.length === 0) {
    return 'Atom must have at least one path pattern';
  }
  if (paths.length > 20) {
    return 'Atom can have at most 20 path patterns';
  }
  for (const pattern of paths) {
    if (pattern.length > 512) {
      return `Path pattern exceeds 512 characters: ${pattern.substring(0, 50)}...`;
    }
    if (pattern.startsWith('/')) {
      return `Path pattern must be relative (no leading /): ${pattern}`;
    }
    if (pattern.includes('..')) {
      return `Path pattern must not contain traversal segments (..): ${pattern}`;
    }
  }
  return null;
}

// ============================================================================
// Glob Matching
// ============================================================================

/**
 * Match a file path against a glob pattern using Bun.Glob.
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  try {
    const glob = new Bun.Glob(pattern);
    return glob.match(filePath);
  } catch {
    return false;
  }
}

/**
 * Find all atoms in a project whose path patterns match any of the given file paths.
 * Returns atoms with their matched paths.
 */
export function findAtomsByPaths(
  projectId: string,
  filePaths: string[]
): Result<{ atoms: Array<Atom & { matchedPaths: string[] }>; unmatchedPaths: string[] }> {
  try {
    const allAtoms = queryAll<AtomRow>(
      'SELECT * FROM graph_atoms WHERE project_id = ?',
      [projectId]
    );

    const matchedPathsSet = new Set<string>();
    const atomMatches: Array<Atom & { matchedPaths: string[] }> = [];

    for (const atomRow of allAtoms) {
      const atom = rowToAtom(atomRow);
      const matched: string[] = [];

      for (const filePath of filePaths) {
        for (const pattern of atom.paths) {
          if (matchesGlob(filePath, pattern)) {
            matched.push(filePath);
            matchedPathsSet.add(filePath);
            break; // one match per file per atom is enough
          }
        }
      }

      if (matched.length > 0) {
        atomMatches.push({ ...atom, matchedPaths: matched });
      }
    }

    const unmatchedPaths = filePaths.filter(p => !matchedPathsSet.has(p));

    return ok({ atoms: atomMatches, unmatchedPaths });
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

// ============================================================================
// Repository Functions
// ============================================================================

export function createAtom(params: {
  projectId: string;
  moleculeId?: string | null;
  name: string;
  paths: string;
  knowledge?: string;
  relatedAtoms?: string;
  createdByTaskId: string;
}): Result<Atom> {
  try {
    // Validate project exists
    const project = queryOne<{ id: string }>('SELECT id FROM projects WHERE id = ?', [params.projectId]);
    if (!project) {
      return err(`Project not found: ${params.projectId}`, 'NOT_FOUND');
    }

    // Validate name
    if (!params.name || !params.name.trim()) {
      return err('Atom name cannot be empty', 'VALIDATION_ERROR');
    }
    if (params.name.length > 255) {
      return err('Atom name must be 255 characters or less', 'VALIDATION_ERROR');
    }

    // Validate and parse paths
    let pathsArray: string[];
    try {
      pathsArray = JSON.parse(params.paths);
      if (!Array.isArray(pathsArray)) {
        return err('paths must be a JSON array', 'VALIDATION_ERROR');
      }
    } catch {
      return err('paths must be valid JSON', 'VALIDATION_ERROR');
    }

    const pathError = validatePathPatterns(pathsArray);
    if (pathError) {
      return err(pathError, 'VALIDATION_ERROR');
    }

    // Validate knowledge size
    const knowledge = params.knowledge?.trim() ?? '';
    if (knowledge.length > 32768) {
      return err('Knowledge must be 32KB or less', 'VALIDATION_ERROR');
    }

    // Validate moleculeId if provided
    if (params.moleculeId) {
      const molecule = queryOne<{ id: string; project_id: string }>(
        'SELECT id, project_id FROM graph_molecules WHERE id = ?',
        [params.moleculeId]
      );
      if (!molecule) {
        return err(`Molecule not found: ${params.moleculeId}`, 'NOT_FOUND');
      }
      if (molecule.project_id !== params.projectId) {
        return err('Atom and molecule must belong to the same project', 'INVARIANT_VIOLATION');
      }
    }

    // Validate relatedAtoms
    let relatedAtoms = '[]';
    if (params.relatedAtoms) {
      try {
        const parsed = JSON.parse(params.relatedAtoms);
        if (!Array.isArray(parsed)) {
          return err('relatedAtoms must be a JSON array', 'VALIDATION_ERROR');
        }
        if (parsed.length > 50) {
          return err('relatedAtoms must have 50 entries or less', 'VALIDATION_ERROR');
        }
        relatedAtoms = params.relatedAtoms;
      } catch {
        return err('relatedAtoms must be valid JSON', 'VALIDATION_ERROR');
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
      `INSERT INTO graph_atoms (id, project_id, molecule_id, name, paths, knowledge, related_atoms, created_by_task_id, last_task_id, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, params.projectId, params.moleculeId ?? null, params.name.trim(), params.paths, knowledge, relatedAtoms, params.createdByTaskId, params.createdByTaskId, timestamp, timestamp]
    );

    const row = queryOne<AtomRow>('SELECT * FROM graph_atoms WHERE id = ?', [id]);
    if (!row) {
      return err('Failed to create atom', 'INTERNAL_ERROR');
    }

    return ok(rowToAtom(row));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function getAtom(id: string): Result<Atom> {
  try {
    const row = queryOne<AtomRow>('SELECT * FROM graph_atoms WHERE id = ?', [id]);
    if (!row) {
      return err(`Atom not found: ${id}`, 'NOT_FOUND');
    }
    return ok(rowToAtom(row));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function updateAtom(
  id: string,
  params: {
    name?: string;
    paths?: string;
    knowledge?: string;
    knowledgeMode?: 'overwrite' | 'append';
    moleculeId?: string | null;
    relatedAtoms?: string;
    lastTaskId?: string;
    version: number;
  }
): Result<Atom> {
  try {
    const result = transaction(() => {
      const existing = queryOne<AtomRow>('SELECT * FROM graph_atoms WHERE id = ?', [id]);
      if (!existing) {
        return { error: `Atom not found: ${id}`, code: 'NOT_FOUND' };
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
          return { error: 'Atom name cannot be empty', code: 'VALIDATION_ERROR' };
        }
        if (params.name.length > 255) {
          return { error: 'Atom name must be 255 characters or less', code: 'VALIDATION_ERROR' };
        }
      }

      // Validate paths
      let pathsValue = existing.paths;
      if (params.paths !== undefined) {
        let pathsArray: string[];
        try {
          pathsArray = JSON.parse(params.paths);
          if (!Array.isArray(pathsArray)) {
            return { error: 'paths must be a JSON array', code: 'VALIDATION_ERROR' };
          }
        } catch {
          return { error: 'paths must be valid JSON', code: 'VALIDATION_ERROR' };
        }

        const pathError = validatePathPatterns(pathsArray);
        if (pathError) {
          return { error: pathError, code: 'VALIDATION_ERROR' };
        }
        pathsValue = params.paths;
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

      // Validate moleculeId if provided
      let moleculeIdValue = existing.molecule_id;
      if (params.moleculeId !== undefined) {
        if (params.moleculeId === null) {
          moleculeIdValue = null;
        } else {
          const molecule = queryOne<{ id: string; project_id: string }>(
            'SELECT id, project_id FROM graph_molecules WHERE id = ?',
            [params.moleculeId]
          );
          if (!molecule) {
            return { error: `Molecule not found: ${params.moleculeId}`, code: 'NOT_FOUND' };
          }
          if (molecule.project_id !== existing.project_id) {
            return { error: 'Atom and molecule must belong to the same project', code: 'INVARIANT_VIOLATION' };
          }
          moleculeIdValue = params.moleculeId;
        }
      }

      // Validate relatedAtoms
      let relatedAtoms = existing.related_atoms;
      if (params.relatedAtoms !== undefined) {
        try {
          const parsed = JSON.parse(params.relatedAtoms);
          if (!Array.isArray(parsed)) {
            return { error: 'relatedAtoms must be a JSON array', code: 'VALIDATION_ERROR' };
          }
          if (parsed.length > 50) {
            return { error: 'relatedAtoms must have 50 entries or less', code: 'VALIDATION_ERROR' };
          }
          relatedAtoms = params.relatedAtoms;
        } catch {
          return { error: 'relatedAtoms must be valid JSON', code: 'VALIDATION_ERROR' };
        }
      }

      const name = params.name?.trim() ?? existing.name;
      const lastTaskId = params.lastTaskId ?? existing.last_task_id;
      const updatedAt = now();

      execute(
        `UPDATE graph_atoms SET name = ?, paths = ?, knowledge = ?, molecule_id = ?, related_atoms = ?, last_task_id = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [name, pathsValue, knowledgeValue, moleculeIdValue, relatedAtoms, lastTaskId, updatedAt, id]
      );

      const updated = queryOne<AtomRow>('SELECT * FROM graph_atoms WHERE id = ?', [id]);
      if (!updated) {
        return { error: 'Failed to retrieve updated atom', code: 'INTERNAL_ERROR' };
      }

      return { success: true as const, data: rowToAtom(updated) };
    });

    if ('error' in result) {
      return err(result.error as string, result.code as string);
    }

    return ok(result.data);
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function deleteAtom(
  id: string,
  params: { version: number }
): Result<boolean> {
  try {
    const result = transaction(() => {
      const existing = queryOne<AtomRow>('SELECT * FROM graph_atoms WHERE id = ?', [id]);
      if (!existing) {
        return { error: `Atom not found: ${id}`, code: 'NOT_FOUND' };
      }

      if (existing.version !== params.version) {
        return {
          error: `Version conflict: expected ${params.version}, current version is ${existing.version}`,
          code: 'CONFLICT',
          currentVersion: existing.version,
        };
      }

      // Delete atom's changelog entries
      execute("DELETE FROM graph_changelog WHERE parent_type = 'atom' AND parent_id = ?", [id]);

      // Delete the atom
      execute('DELETE FROM graph_atoms WHERE id = ?', [id]);

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

export function searchAtoms(params: {
  projectId: string;
  moleculeId?: string;
  query?: string;
  orphansOnly?: boolean;
  limit?: number;
  offset?: number;
}): Result<Atom[]> {
  try {
    const conditions: string[] = ['project_id = ?'];
    const values: any[] = [params.projectId];

    if (params.moleculeId) {
      conditions.push('molecule_id = ?');
      values.push(params.moleculeId);
    }

    if (params.orphansOnly) {
      conditions.push('molecule_id IS NULL');
    }

    if (params.query?.trim()) {
      conditions.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(knowledge) LIKE ? ESCAPE '\\')");
      const escaped = params.query.toLowerCase().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const q = `%${escaped}%`;
      values.push(q, q);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const paginationClause = buildPaginationClause({ limit: params.limit, offset: params.offset });

    const sql = `SELECT * FROM graph_atoms ${whereClause} ORDER BY name ASC${paginationClause}`;
    const rows = queryAll<AtomRow>(sql, values);

    return ok(rows.map(rowToAtom));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}

export function getAtomsByMolecule(moleculeId: string): Result<Atom[]> {
  try {
    const rows = queryAll<AtomRow>(
      'SELECT * FROM graph_atoms WHERE molecule_id = ? ORDER BY name ASC',
      [moleculeId]
    );
    return ok(rows.map(rowToAtom));
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error', 'INTERNAL_ERROR');
  }
}
