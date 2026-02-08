import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { Priority } from '../domain/types';
import { createProject } from './projects';
import { createFeature } from './features';
import { createTask } from './tasks';
import { appendChangelog, searchChangelog, getRecentChangelog } from './graph-changelog';
import { createAtom } from './graph-atoms';
import { createMolecule } from './graph-molecules';
import { extractFilePathsFromSection } from '../tools/query-container';

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

// ============================================================================
// Helper: create prerequisite entities
// ============================================================================

function createPrerequisites() {
  const project = createProject({ name: 'Graph Project', summary: 'Test project' });
  if (!project.success) throw new Error('Failed to create project');

  const feature = createFeature({
    name: 'Graph Feature',
    summary: 'Test feature',
    priority: Priority.HIGH,
    projectId: project.data.id,
  });
  if (!feature.success) throw new Error('Failed to create feature');

  const task = createTask({
    title: 'Graph Task',
    summary: 'Test task',
    priority: Priority.HIGH,
    complexity: 3,
    projectId: project.data.id,
    featureId: feature.data.id,
  });
  if (!task.success) throw new Error('Failed to create task');

  return { project: project.data, feature: feature.data, task: task.data };
}

function createAtomForTest(projectId: string, taskId: string) {
  const atom = createAtom({
    projectId,
    name: 'TestAtom',
    paths: JSON.stringify(['src/utils/**']),
    createdByTaskId: taskId,
  });
  if (!atom.success) throw new Error('Failed to create atom');
  return atom.data;
}

function createMoleculeForTest(projectId: string, taskId: string) {
  const molecule = createMolecule({
    projectId,
    name: 'TestMolecule',
    createdByTaskId: taskId,
  });
  if (!molecule.success) throw new Error('Failed to create molecule');
  return molecule.data;
}

// ============================================================================
// appendChangelog
// ============================================================================

describe('appendChangelog', () => {
  it('should append entry to atom with correct fields', () => {
    const { project, task } = createPrerequisites();
    const atom = createAtomForTest(project.id, task.id);

    const result = appendChangelog({
      parentType: 'atom',
      parentId: atom.id,
      taskId: task.id,
      summary: 'Updated knowledge for auth module',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBeDefined();
      expect(result.data.parentType).toBe('atom');
      expect(result.data.parentId).toBe(atom.id);
      expect(result.data.taskId).toBe(task.id);
      expect(result.data.summary).toBe('Updated knowledge for auth module');
      expect(result.data.createdAt).toBeDefined();
    }
  });

  it('should append entry to molecule', () => {
    const { project, task } = createPrerequisites();
    const molecule = createMoleculeForTest(project.id, task.id);

    const result = appendChangelog({
      parentType: 'molecule',
      parentId: molecule.id,
      taskId: task.id,
      summary: 'Refactored molecule grouping',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentType).toBe('molecule');
      expect(result.data.parentId).toBe(molecule.id);
      expect(result.data.summary).toBe('Refactored molecule grouping');
    }
  });

  it('should reject empty summary', () => {
    const { project, task } = createPrerequisites();
    const atom = createAtomForTest(project.id, task.id);

    const result = appendChangelog({
      parentType: 'atom',
      parentId: atom.id,
      taskId: task.id,
      summary: '   ',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('empty');
    }
  });

  it('should reject summary exceeding 4096 characters', () => {
    const { project, task } = createPrerequisites();
    const atom = createAtomForTest(project.id, task.id);

    const result = appendChangelog({
      parentType: 'atom',
      parentId: atom.id,
      taskId: task.id,
      summary: 'x'.repeat(4097),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('4KB');
    }
  });

  it('should reject non-existent parentId for atom', () => {
    const { task } = createPrerequisites();

    const result = appendChangelog({
      parentType: 'atom',
      parentId: 'nonexistent-atom-id',
      taskId: task.id,
      summary: 'Some change',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Atom not found');
    }
  });

  it('should reject non-existent parentId for molecule', () => {
    const { task } = createPrerequisites();

    const result = appendChangelog({
      parentType: 'molecule',
      parentId: 'nonexistent-molecule-id',
      taskId: task.id,
      summary: 'Some change',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Molecule not found');
    }
  });

  it('should reject non-existent taskId', () => {
    const { project, task } = createPrerequisites();
    const atom = createAtomForTest(project.id, task.id);

    const result = appendChangelog({
      parentType: 'atom',
      parentId: atom.id,
      taskId: 'nonexistent-task-id',
      summary: 'Some change',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Task not found');
    }
  });
});

// ============================================================================
// searchChangelog
// ============================================================================

describe('searchChangelog', () => {
  it('should return entries for an atom ordered by created_at DESC', () => {
    const { project, task } = createPrerequisites();
    const atom = createAtomForTest(project.id, task.id);

    appendChangelog({ parentType: 'atom', parentId: atom.id, taskId: task.id, summary: 'First entry' });
    appendChangelog({ parentType: 'atom', parentId: atom.id, taskId: task.id, summary: 'Second entry' });
    appendChangelog({ parentType: 'atom', parentId: atom.id, taskId: task.id, summary: 'Third entry' });

    const result = searchChangelog({ parentType: 'atom', parentId: atom.id });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(3);
      const summaries = result.data.map(e => e.summary).sort();
      expect(summaries).toEqual(['First entry', 'Second entry', 'Third entry']);
      // All entries should have the correct parentType and parentId
      for (const entry of result.data) {
        expect(entry.parentType).toBe('atom');
        expect(entry.parentId).toBe(atom.id);
      }
    }
  });

  it('should respect limit and offset', () => {
    const { project, task } = createPrerequisites();
    const atom = createAtomForTest(project.id, task.id);

    appendChangelog({ parentType: 'atom', parentId: atom.id, taskId: task.id, summary: 'Entry 1' });
    appendChangelog({ parentType: 'atom', parentId: atom.id, taskId: task.id, summary: 'Entry 2' });
    appendChangelog({ parentType: 'atom', parentId: atom.id, taskId: task.id, summary: 'Entry 3' });

    const result = searchChangelog({ parentType: 'atom', parentId: atom.id, limit: 1, offset: 1 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0].summary).toBe('Entry 2');
    }
  });

  it('should return empty array when no entries exist', () => {
    const result = searchChangelog({ parentType: 'atom', parentId: 'nonexistent-id' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });
});

// ============================================================================
// getRecentChangelog
// ============================================================================

describe('getRecentChangelog', () => {
  it('should return last N entries with default limit of 5', () => {
    const { project, task } = createPrerequisites();
    const atom = createAtomForTest(project.id, task.id);

    for (let i = 1; i <= 7; i++) {
      appendChangelog({ parentType: 'atom', parentId: atom.id, taskId: task.id, summary: `Entry ${i}` });
    }

    const entries = getRecentChangelog('atom', atom.id);

    expect(entries.length).toBe(5);
    // Verify all returned entries belong to the atom
    for (const entry of entries) {
      expect(entry.parentType).toBe('atom');
      expect(entry.parentId).toBe(atom.id);
    }
  });

  it('should respect custom limit', () => {
    const { project, task } = createPrerequisites();
    const molecule = createMoleculeForTest(project.id, task.id);

    for (let i = 1; i <= 4; i++) {
      appendChangelog({ parentType: 'molecule', parentId: molecule.id, taskId: task.id, summary: `Mol entry ${i}` });
    }

    const entries = getRecentChangelog('molecule', molecule.id, 2);

    expect(entries.length).toBe(2);
    // Verify entries belong to the molecule
    for (const entry of entries) {
      expect(entry.parentType).toBe('molecule');
      expect(entry.parentId).toBe(molecule.id);
    }
  });

  it('should return empty array for non-existent entity', () => {
    const entries = getRecentChangelog('atom', 'nonexistent-id');

    expect(entries).toEqual([]);
  });
});

// ============================================================================
// extractFilePathsFromSection
// ============================================================================

describe('extractFilePathsFromSection', () => {
  it('should extract line-delimited paths', () => {
    const content = 'src/index.ts\nsrc/utils/helper.ts\nsrc/db/client.ts';
    const paths = extractFilePathsFromSection(content);

    expect(paths).toEqual(['src/index.ts', 'src/utils/helper.ts', 'src/db/client.ts']);
  });

  it('should extract comma-separated paths', () => {
    const content = 'src/a.ts, src/b.ts, src/c.ts';
    const paths = extractFilePathsFromSection(content);

    expect(paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('should handle mixed line and comma format', () => {
    const content = 'src/a.ts, src/b.ts\nsrc/c.ts';
    const paths = extractFilePathsFromSection(content);

    expect(paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('should skip empty lines', () => {
    const content = 'src/a.ts\n\n\nsrc/b.ts\n';
    const paths = extractFilePathsFromSection(content);

    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should skip comment lines starting with #', () => {
    const content = '# These are context files\nsrc/a.ts\n# another comment\nsrc/b.ts';
    const paths = extractFilePathsFromSection(content);

    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should skip comment lines starting with //', () => {
    const content = '// File list\nsrc/a.ts\n// more comments\nsrc/b.ts';
    const paths = extractFilePathsFromSection(content);

    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should return empty array for empty or whitespace content', () => {
    expect(extractFilePathsFromSection('   ')).toEqual([]);
    expect(extractFilePathsFromSection('\n\n')).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(extractFilePathsFromSection('')).toEqual([]);
  });

  it('should trim whitespace from paths', () => {
    const content = '  src/a.ts  \n  src/b.ts  ';
    const paths = extractFilePathsFromSection(content);

    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
