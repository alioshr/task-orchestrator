import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { Priority } from '../domain/types';
import {
  createMolecule,
  getMolecule,
  updateMolecule,
  deleteMolecule,
  searchMolecules,
} from './graph-molecules';
import { createAtom } from './graph-atoms';
import { appendChangelog } from './graph-changelog';
import { createProject } from './projects';
import { createFeature } from './features';
import { createTask } from './tasks';

function cleanup() {
  db.run('DELETE FROM graph_changelog');
  db.run('DELETE FROM graph_atoms');
  db.run('DELETE FROM graph_molecules');
  db.run('DELETE FROM sections');
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
}

function createPrerequisites() {
  const project = createProject({ name: 'Test Project', summary: 'A project' });
  if (!project.success) throw new Error('Failed to create project');

  const feature = createFeature({
    projectId: project.data.id,
    name: 'Test Feature',
    summary: 'A feature',
    priority: Priority.HIGH,
  });
  if (!feature.success) throw new Error('Failed to create feature');

  const task = createTask({
    featureId: feature.data.id,
    title: 'Test Task',
    summary: 'A task',
    priority: Priority.HIGH,
    complexity: 3,
  });
  if (!task.success) throw new Error('Failed to create task');

  return { projectId: project.data.id, featureId: feature.data.id, taskId: task.data.id };
}

beforeEach(() => {
  cleanup();
});

afterAll(() => {
  cleanup();
});

// ============================================================================
// createMolecule
// ============================================================================

describe('createMolecule', () => {
  it('should create a molecule with required fields and return version 1', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createMolecule({
      projectId,
      name: 'Auth Module',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBeDefined();
      expect(result.data.projectId).toBe(projectId);
      expect(result.data.name).toBe('Auth Module');
      expect(result.data.knowledge).toBe('');
      expect(result.data.relatedMolecules).toEqual([]);
      expect(result.data.createdByTaskId).toBe(taskId);
      expect(result.data.lastTaskId).toBe(taskId);
      expect(result.data.version).toBe(1);
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
    }
  });

  it('should create a molecule with optional knowledge and relatedMolecules', () => {
    const { projectId, taskId } = createPrerequisites();
    const related = JSON.stringify([{ moleculeId: 'abc', reason: 'shared logic' }]);

    const result = createMolecule({
      projectId,
      name: 'Data Layer',
      knowledge: 'Handles persistence',
      relatedMolecules: related,
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledge).toBe('Handles persistence');
      expect(result.data.relatedMolecules).toEqual([{ moleculeId: 'abc', reason: 'shared logic' }]);
    }
  });

  it('should reject empty name', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createMolecule({
      projectId,
      name: '   ',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('name cannot be empty');
    }
  });

  it('should reject name longer than 255 characters', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createMolecule({
      projectId,
      name: 'x'.repeat(256),
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('255');
    }
  });

  it('should reject knowledge longer than 32768 characters', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createMolecule({
      projectId,
      name: 'Big Knowledge',
      knowledge: 'x'.repeat(32769),
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('32KB');
    }
  });

  it('should reject non-existent projectId', () => {
    const { taskId } = createPrerequisites();

    const result = createMolecule({
      projectId: 'non-existent-project',
      name: 'Orphan Molecule',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Project not found');
    }
  });

  it('should reject non-existent createdByTaskId', () => {
    const { projectId } = createPrerequisites();

    const result = createMolecule({
      projectId,
      name: 'No Task Molecule',
      createdByTaskId: 'non-existent-task',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Task not found');
    }
  });

  it('should reject invalid relatedMolecules JSON', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createMolecule({
      projectId,
      name: 'Bad JSON Molecule',
      relatedMolecules: 'not-json',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('valid JSON');
    }
  });

  it('should reject relatedMolecules with more than 50 entries', () => {
    const { projectId, taskId } = createPrerequisites();
    const entries = Array.from({ length: 51 }, (_, i) => ({ moleculeId: `m${i}`, reason: 'r' }));

    const result = createMolecule({
      projectId,
      name: 'Too Many Relations',
      relatedMolecules: JSON.stringify(entries),
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('50');
    }
  });
});

// ============================================================================
// getMolecule
// ============================================================================

describe('getMolecule', () => {
  it('should retrieve an existing molecule by id', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Retrievable',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = getMolecule(created.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.name).toBe('Retrievable');
      expect(result.data.projectId).toBe(projectId);
    }
  });

  it('should return NOT_FOUND for non-existent id', () => {
    const result = getMolecule('non-existent-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Molecule not found');
    }
  });
});

// ============================================================================
// updateMolecule
// ============================================================================

describe('updateMolecule', () => {
  it('should update the molecule name', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Original',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateMolecule(created.data.id, {
      name: 'Updated Name',
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
    }
  });

  it('should update knowledge in overwrite mode', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Knowledge Mol',
      knowledge: 'old knowledge',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateMolecule(created.data.id, {
      knowledge: 'new knowledge',
      knowledgeMode: 'overwrite',
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledge).toBe('new knowledge');
    }
  });

  it('should update knowledge in append mode with separator', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Append Mol',
      knowledge: 'initial',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateMolecule(created.data.id, {
      knowledge: 'appended',
      knowledgeMode: 'append',
      lastTaskId: taskId,
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledge).toContain('initial');
      expect(result.data.knowledge).toContain('appended');
      expect(result.data.knowledge).toContain('---[');
      expect(result.data.knowledge).toContain(`task:${taskId}`);
    }
  });

  it('should reject version conflict', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Conflict Mol',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateMolecule(created.data.id, {
      name: 'Should Fail',
      version: 999,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CONFLICT');
      expect(result.error).toContain('Version conflict');
    }
  });

  it('should reject empty name', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Valid Name',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateMolecule(created.data.id, {
      name: '   ',
      version: 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('name cannot be empty');
    }
  });

  it('should return NOT_FOUND for non-existent molecule', () => {
    const result = updateMolecule('non-existent-id', {
      name: 'Does Not Matter',
      version: 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('should increment version on successful update', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Version Mol',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    expect(created.data.version).toBe(1);

    const updated = updateMolecule(created.data.id, {
      name: 'Version Mol v2',
      version: 1,
    });

    expect(updated.success).toBe(true);
    if (updated.success) {
      expect(updated.data.version).toBe(2);
    }
  });
});

// ============================================================================
// deleteMolecule
// ============================================================================

describe('deleteMolecule', () => {
  it('should delete an existing molecule with correct version', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'To Delete',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteMolecule(created.data.id, { version: 1 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }

    const getResult = getMolecule(created.data.id);
    expect(getResult.success).toBe(false);
  });

  it('should reject version conflict on delete', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createMolecule({
      projectId,
      name: 'Conflict Delete',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteMolecule(created.data.id, { version: 999 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CONFLICT');
      expect(result.error).toContain('Version conflict');
    }
  });

  it('should return NOT_FOUND for non-existent molecule', () => {
    const result = deleteMolecule('non-existent-id', { version: 1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('should cascade delete member atoms and their changelog entries', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({
      projectId,
      name: 'Cascade Mol',
      createdByTaskId: taskId,
    });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    const atom = createAtom({
      projectId,
      moleculeId: mol.data.id,
      name: 'Member Atom',
      paths: JSON.stringify(['src/**/*.ts']),
      createdByTaskId: taskId,
    });
    expect(atom.success).toBe(true);
    if (!atom.success) return;

    const changelog = appendChangelog({
      parentType: 'atom',
      parentId: atom.data.id,
      taskId,
      summary: 'Initial creation',
    });
    expect(changelog.success).toBe(true);

    const result = deleteMolecule(mol.data.id, { version: 1, cascade: true });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }

    const atomRows = db
      .query('SELECT * FROM graph_atoms WHERE id = ?')
      .all(atom.data.id);
    expect(atomRows.length).toBe(0);

    const changelogRows = db
      .query("SELECT * FROM graph_changelog WHERE parent_type = 'atom' AND parent_id = ?")
      .all(atom.data.id);
    expect(changelogRows.length).toBe(0);
  });

  it('should orphan member atoms when cascade is false (default)', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({
      projectId,
      name: 'Orphan Mol',
      createdByTaskId: taskId,
    });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    const atom = createAtom({
      projectId,
      moleculeId: mol.data.id,
      name: 'Will Be Orphaned',
      paths: JSON.stringify(['src/index.ts']),
      createdByTaskId: taskId,
    });
    expect(atom.success).toBe(true);
    if (!atom.success) return;

    const result = deleteMolecule(mol.data.id, { version: 1 });

    expect(result.success).toBe(true);

    const atomRow = db
      .query('SELECT molecule_id FROM graph_atoms WHERE id = ?')
      .get(atom.data.id) as { molecule_id: string | null } | null;
    expect(atomRow).not.toBeNull();
    if (atomRow) {
      expect(atomRow.molecule_id).toBeNull();
    }
  });
});

// ============================================================================
// searchMolecules
// ============================================================================

describe('searchMolecules', () => {
  it('should return all molecules for a project', () => {
    const { projectId, taskId } = createPrerequisites();

    createMolecule({ projectId, name: 'Molecule A', createdByTaskId: taskId });
    createMolecule({ projectId, name: 'Molecule B', createdByTaskId: taskId });

    const result = searchMolecules({ projectId });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
    }
  });

  it('should search by query text matching name or knowledge', () => {
    const { projectId, taskId } = createPrerequisites();

    createMolecule({ projectId, name: 'Auth Module', createdByTaskId: taskId });
    createMolecule({
      projectId,
      name: 'Data Layer',
      knowledge: 'Handles authentication tokens',
      createdByTaskId: taskId,
    });
    createMolecule({ projectId, name: 'Unrelated', createdByTaskId: taskId });

    const result = searchMolecules({ projectId, query: 'auth' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
      const names = result.data.map((m) => m.name).sort();
      expect(names).toEqual(['Auth Module', 'Data Layer']);
    }
  });

  it('should respect limit and offset', () => {
    const { projectId, taskId } = createPrerequisites();

    createMolecule({ projectId, name: 'Alpha', createdByTaskId: taskId });
    createMolecule({ projectId, name: 'Beta', createdByTaskId: taskId });
    createMolecule({ projectId, name: 'Gamma', createdByTaskId: taskId });

    const result = searchMolecules({ projectId, limit: 1, offset: 1 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.name).toBe('Beta');
    }
  });

  it('should return empty array when no matches', () => {
    const { projectId } = createPrerequisites();

    const result = searchMolecules({ projectId, query: 'nonexistent' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(0);
    }
  });

  it('should escape LIKE wildcards in query so literal % and _ do not match as wildcards', () => {
    const { projectId, taskId } = createPrerequisites();

    createMolecule({ projectId, name: 'Normal Molecule', createdByTaskId: taskId });
    createMolecule({ projectId, name: '100% Complete', createdByTaskId: taskId });
    createMolecule({ projectId, name: 'under_score', createdByTaskId: taskId });

    const percentResult = searchMolecules({ projectId, query: '100%' });
    expect(percentResult.success).toBe(true);
    if (percentResult.success) {
      expect(percentResult.data.length).toBe(1);
      expect(percentResult.data[0]!.name).toBe('100% Complete');
    }

    const underscoreResult = searchMolecules({ projectId, query: 'under_score' });
    expect(underscoreResult.success).toBe(true);
    if (underscoreResult.success) {
      expect(underscoreResult.data.length).toBe(1);
      expect(underscoreResult.data[0]!.name).toBe('under_score');
    }
  });
});
