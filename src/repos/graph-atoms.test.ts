import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { Priority } from '../domain/types';
import {
  createAtom,
  getAtom,
  updateAtom,
  deleteAtom,
  searchAtoms,
  findAtomsByPaths,
  getAtomsByMolecule,
} from './graph-atoms';
import { createMolecule } from './graph-molecules';
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

beforeEach(() => {
  cleanup();
});

afterAll(() => {
  cleanup();
});

/** Helper: create a project + feature + task chain, return all three ids. */
function createPrerequisites() {
  const project = createProject({ name: 'Test Project', summary: 'Summary' });
  if (!project.success) throw new Error('Failed to create project');

  const feature = createFeature({
    projectId: project.data.id,
    name: 'Test Feature',
    summary: 'Summary',
    priority: Priority.HIGH,
  });
  if (!feature.success) throw new Error('Failed to create feature');

  const task = createTask({
    featureId: feature.data.id,
    title: 'Test Task',
    summary: 'Summary',
    priority: Priority.HIGH,
    complexity: 3,
  });
  if (!task.success) throw new Error('Failed to create task');

  return { projectId: project.data.id, featureId: feature.data.id, taskId: task.data.id };
}

// ============================================================================
// createAtom
// ============================================================================

describe('createAtom', () => {
  it('should create an atom with required fields', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'Auth Module',
      paths: '["src/**/*.ts"]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBeDefined();
      expect(result.data.projectId).toBe(projectId);
      expect(result.data.moleculeId).toBeNull();
      expect(result.data.name).toBe('Auth Module');
      expect(result.data.paths).toEqual(['src/**/*.ts']);
      expect(result.data.knowledge).toBe('');
      expect(result.data.relatedAtoms).toEqual([]);
      expect(result.data.createdByTaskId).toBe(taskId);
      expect(result.data.lastTaskId).toBe(taskId);
      expect(result.data.version).toBe(1);
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
    }
  });

  it('should create an atom with a moleculeId', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({
      projectId,
      name: 'Core Module',
      createdByTaskId: taskId,
    });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    const result = createAtom({
      projectId,
      moleculeId: mol.data.id,
      name: 'Sub Atom',
      paths: '["src/core/*.ts"]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moleculeId).toBe(mol.data.id);
    }
  });

  it('should create an atom with optional knowledge and relatedAtoms', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'Documented Atom',
      paths: '["docs/**/*.md"]',
      knowledge: 'Important context about this atom',
      relatedAtoms: '[{"atomId":"abc","reason":"shared concern"}]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledge).toBe('Important context about this atom');
      expect(result.data.relatedAtoms).toEqual([{ atomId: 'abc', reason: 'shared concern' }]);
    }
  });

  it('should reject an empty name', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: '   ',
      paths: '["src/**/*.ts"]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('empty');
    }
  });

  it('should reject a name longer than 255 characters', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'a'.repeat(256),
      paths: '["src/**/*.ts"]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('255');
    }
  });

  it('should reject an empty paths array', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'Empty Paths',
      paths: '[]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('at least one');
    }
  });

  it('should reject paths with more than 20 entries', () => {
    const { projectId, taskId } = createPrerequisites();

    const manyPaths = JSON.stringify(Array.from({ length: 21 }, (_, i) => `src/path${i}/*.ts`));

    const result = createAtom({
      projectId,
      name: 'Too Many Paths',
      paths: manyPaths,
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('at most 20');
    }
  });

  it('should reject a path pattern longer than 512 characters', () => {
    const { projectId, taskId } = createPrerequisites();

    const longPath = 'a'.repeat(513);

    const result = createAtom({
      projectId,
      name: 'Long Path',
      paths: JSON.stringify([longPath]),
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('512');
    }
  });

  it('should reject a path with a leading /', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'Absolute Path',
      paths: '["/src/foo.ts"]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('relative');
    }
  });

  it('should reject a path with .. traversal', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'Traversal Path',
      paths: '["src/../etc/passwd"]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('..');
    }
  });

  it('should reject a non-existent projectId', () => {
    const { taskId } = createPrerequisites();

    const result = createAtom({
      projectId: 'nonexistent-project-id',
      name: 'Orphan',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Project not found');
    }
  });

  it('should reject a non-existent createdByTaskId', () => {
    const { projectId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'Bad Task Ref',
      paths: '["src/*.ts"]',
      createdByTaskId: 'nonexistent-task-id',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Task not found');
    }
  });

  it('should reject a molecule from a different project (INVARIANT_VIOLATION)', () => {
    const prereq1 = createPrerequisites();
    const prereq2 = createPrerequisites();

    const mol = createMolecule({
      projectId: prereq2.projectId,
      name: 'Other Project Molecule',
      createdByTaskId: prereq2.taskId,
    });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    const result = createAtom({
      projectId: prereq1.projectId,
      moleculeId: mol.data.id,
      name: 'Cross Project Atom',
      paths: '["src/*.ts"]',
      createdByTaskId: prereq1.taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('INVARIANT_VIOLATION');
      expect(result.error).toContain('same project');
    }
  });

  it('should reject knowledge exceeding 32768 characters', () => {
    const { projectId, taskId } = createPrerequisites();

    const result = createAtom({
      projectId,
      name: 'Huge Knowledge',
      paths: '["src/*.ts"]',
      knowledge: 'x'.repeat(32769),
      createdByTaskId: taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('32KB');
    }
  });
});

// ============================================================================
// getAtom
// ============================================================================

describe('getAtom', () => {
  it('should retrieve an existing atom', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Retrievable',
      paths: '["src/**/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = getAtom(created.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.name).toBe('Retrievable');
      expect(result.data.paths).toEqual(['src/**/*.ts']);
    }
  });

  it('should return NOT_FOUND for a non-existent id', () => {
    const result = getAtom('nonexistent-atom-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Atom not found');
    }
  });
});

// ============================================================================
// updateAtom
// ============================================================================

describe('updateAtom', () => {
  it('should update the name', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Original',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateAtom(created.data.id, {
      name: 'Updated Name',
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
    }
  });

  it('should update paths', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Path Atom',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateAtom(created.data.id, {
      paths: '["lib/**/*.js","dist/*.mjs"]',
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paths).toEqual(['lib/**/*.js', 'dist/*.mjs']);
    }
  });

  it('should update knowledge in overwrite mode', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Knowledge Atom',
      paths: '["src/*.ts"]',
      knowledge: 'old knowledge',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateAtom(created.data.id, {
      knowledge: 'new knowledge',
      knowledgeMode: 'overwrite',
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledge).toBe('new knowledge');
    }
  });

  it('should update knowledge in append mode with separator containing timestamp and task ref', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Append Atom',
      paths: '["src/*.ts"]',
      knowledge: 'initial',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateAtom(created.data.id, {
      knowledge: 'appended text',
      knowledgeMode: 'append',
      lastTaskId: taskId,
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledge).toContain('initial');
      expect(result.data.knowledge).toContain('appended text');
      expect(result.data.knowledge).toContain('---[');
      expect(result.data.knowledge).toContain(`task:${taskId}`);
    }
  });

  it('should update moleculeId (assign to molecule)', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({
      projectId,
      name: 'Target Molecule',
      createdByTaskId: taskId,
    });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    const created = createAtom({
      projectId,
      name: 'Orphan Atom',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateAtom(created.data.id, {
      moleculeId: mol.data.id,
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moleculeId).toBe(mol.data.id);
    }
  });

  it('should set moleculeId to null (orphan)', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({
      projectId,
      name: 'Source Molecule',
      createdByTaskId: taskId,
    });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    const created = createAtom({
      projectId,
      moleculeId: mol.data.id,
      name: 'Assigned Atom',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    expect(created.data.moleculeId).toBe(mol.data.id);

    const result = updateAtom(created.data.id, {
      moleculeId: null,
      version: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moleculeId).toBeNull();
    }
  });

  it('should reject a version conflict (CONFLICT)', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Versioned',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateAtom(created.data.id, {
      name: 'Should Fail',
      version: 999,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CONFLICT');
      expect(result.error).toContain('Version conflict');
    }
  });

  it('should reject a molecule from a different project (INVARIANT_VIOLATION)', () => {
    const prereq1 = createPrerequisites();
    const prereq2 = createPrerequisites();

    const mol = createMolecule({
      projectId: prereq2.projectId,
      name: 'Other Molecule',
      createdByTaskId: prereq2.taskId,
    });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    const created = createAtom({
      projectId: prereq1.projectId,
      name: 'Atom to Reassign',
      paths: '["src/*.ts"]',
      createdByTaskId: prereq1.taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateAtom(created.data.id, {
      moleculeId: mol.data.id,
      version: 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('INVARIANT_VIOLATION');
      expect(result.error).toContain('same project');
    }
  });

  it('should increment version on update', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Version Atom',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    expect(created.data.version).toBe(1);

    const updated = updateAtom(created.data.id, {
      name: 'Version 2',
      version: 1,
    });

    expect(updated.success).toBe(true);
    if (updated.success) {
      expect(updated.data.version).toBe(2);
    }
  });
});

// ============================================================================
// deleteAtom
// ============================================================================

describe('deleteAtom', () => {
  it('should delete an atom with the correct version', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'To Delete',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteAtom(created.data.id, { version: 1 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }

    const getResult = getAtom(created.data.id);
    expect(getResult.success).toBe(false);
  });

  it('should also delete the atom changelog entries', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Atom With Changelog',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const changelog = appendChangelog({
      parentType: 'atom',
      parentId: created.data.id,
      taskId,
      summary: 'Initial creation',
    });
    expect(changelog.success).toBe(true);

    const result = deleteAtom(created.data.id, { version: 1 });
    expect(result.success).toBe(true);

    const remaining = db.query('SELECT * FROM graph_changelog WHERE parent_id = ?').all(created.data.id);
    expect(remaining.length).toBe(0);
  });

  it('should reject a version conflict', () => {
    const { projectId, taskId } = createPrerequisites();

    const created = createAtom({
      projectId,
      name: 'Version Guarded',
      paths: '["src/*.ts"]',
      createdByTaskId: taskId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteAtom(created.data.id, { version: 999 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CONFLICT');
      expect(result.error).toContain('Version conflict');
    }
  });

  it('should reject a non-existent atom', () => {
    const result = deleteAtom('nonexistent-atom-id', { version: 1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Atom not found');
    }
  });
});

// ============================================================================
// searchAtoms
// ============================================================================

describe('searchAtoms', () => {
  it('should return all atoms for a project', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: 'Atom A', paths: '["a/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Atom B', paths: '["b/*.ts"]', createdByTaskId: taskId });

    const result = searchAtoms({ projectId });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
    }
  });

  it('should filter by moleculeId', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({ projectId, name: 'Filter Mol', createdByTaskId: taskId });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    createAtom({ projectId, moleculeId: mol.data.id, name: 'In Mol', paths: '["a/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Orphan', paths: '["b/*.ts"]', createdByTaskId: taskId });

    const result = searchAtoms({ projectId, moleculeId: mol.data.id });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0].name).toBe('In Mol');
    }
  });

  it('should filter orphansOnly', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({ projectId, name: 'Mol', createdByTaskId: taskId });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    createAtom({ projectId, moleculeId: mol.data.id, name: 'Assigned', paths: '["a/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Orphan Atom', paths: '["b/*.ts"]', createdByTaskId: taskId });

    const result = searchAtoms({ projectId, orphansOnly: true });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0].name).toBe('Orphan Atom');
    }
  });

  it('should search by query text', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: 'Authentication Handler', paths: '["auth/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Database Layer', paths: '["db/*.ts"]', createdByTaskId: taskId });

    const result = searchAtoms({ projectId, query: 'authentication' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0].name).toBe('Authentication Handler');
    }
  });

  it('should respect limit and offset', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: 'Atom A', paths: '["a/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Atom B', paths: '["b/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Atom C', paths: '["c/*.ts"]', createdByTaskId: taskId });

    const result = searchAtoms({ projectId, limit: 1, offset: 1 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0].name).toBe('Atom B');
    }
  });

  it('should escape LIKE wildcards in query', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: '100% done', paths: '["a/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Regular atom', paths: '["b/*.ts"]', createdByTaskId: taskId });

    const result = searchAtoms({ projectId, query: '%' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0].name).toBe('100% done');
    }
  });
});

// ============================================================================
// findAtomsByPaths
// ============================================================================

describe('findAtomsByPaths', () => {
  it('should match a simple glob pattern', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: 'TS Sources', paths: '["src/**/*.ts"]', createdByTaskId: taskId });

    const result = findAtomsByPaths(projectId, ['src/foo/bar.ts']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atoms.length).toBe(1);
      expect(result.data.atoms[0].name).toBe('TS Sources');
      expect(result.data.atoms[0].matchedPaths).toEqual(['src/foo/bar.ts']);
      expect(result.data.unmatchedPaths.length).toBe(0);
    }
  });

  it('should match multiple patterns', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({
      projectId,
      name: 'Multi Pattern',
      paths: '["src/**/*.ts","lib/**/*.js"]',
      createdByTaskId: taskId,
    });

    const result = findAtomsByPaths(projectId, ['src/index.ts', 'lib/utils.js']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atoms.length).toBe(1);
      expect(result.data.atoms[0].matchedPaths).toContain('src/index.ts');
      expect(result.data.atoms[0].matchedPaths).toContain('lib/utils.js');
      expect(result.data.unmatchedPaths.length).toBe(0);
    }
  });

  it('should return unmatchedPaths for non-matching files', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: 'TS Only', paths: '["src/**/*.ts"]', createdByTaskId: taskId });

    const result = findAtomsByPaths(projectId, ['src/foo.ts', 'images/logo.png']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atoms.length).toBe(1);
      expect(result.data.unmatchedPaths).toEqual(['images/logo.png']);
    }
  });

  it('should allow multiple atoms to match the same file', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: 'All TS', paths: '["src/**/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Index Files', paths: '["**/index.ts"]', createdByTaskId: taskId });

    const result = findAtomsByPaths(projectId, ['src/index.ts']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atoms.length).toBe(2);
      expect(result.data.unmatchedPaths.length).toBe(0);
    }
  });

  it('should exclude atoms with no matching files from results', () => {
    const { projectId, taskId } = createPrerequisites();

    createAtom({ projectId, name: 'Python Only', paths: '["src/**/*.py"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'TS Only', paths: '["src/**/*.ts"]', createdByTaskId: taskId });

    const result = findAtomsByPaths(projectId, ['src/app.ts']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atoms.length).toBe(1);
      expect(result.data.atoms[0].name).toBe('TS Only');
    }
  });
});

// ============================================================================
// getAtomsByMolecule
// ============================================================================

describe('getAtomsByMolecule', () => {
  it('should return atoms belonging to a molecule sorted by name', () => {
    const { projectId, taskId } = createPrerequisites();

    const mol = createMolecule({ projectId, name: 'Parent Mol', createdByTaskId: taskId });
    expect(mol.success).toBe(true);
    if (!mol.success) return;

    createAtom({ projectId, moleculeId: mol.data.id, name: 'Zebra', paths: '["z/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, moleculeId: mol.data.id, name: 'Alpha', paths: '["a/*.ts"]', createdByTaskId: taskId });
    createAtom({ projectId, name: 'Orphan', paths: '["o/*.ts"]', createdByTaskId: taskId });

    const result = getAtomsByMolecule(mol.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
      expect(result.data[0].name).toBe('Alpha');
      expect(result.data[1].name).toBe('Zebra');
    }
  });
});
