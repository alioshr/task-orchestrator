import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { checkOrphanedStates, runStartupChecks } from './startup-checks';
import { initConfig, resetConfig } from './index';
import { execute } from '../repos/base';
import { createTask } from '../repos/tasks';
import { createFeature } from '../repos/features';
import { Priority } from '../domain/types';

beforeAll(() => {
  resetConfig();
  initConfig({
    version: '3.0',
    pipelines: {
      feature: ['NEW', 'ACTIVE', 'CLOSED'],
      task: ['NEW', 'ACTIVE', 'CLOSED'],
    },
  });
});

beforeEach(() => {
  execute('DELETE FROM entity_tags', []);
  execute('DELETE FROM sections', []);
  execute('DELETE FROM tasks', []);
  execute('DELETE FROM features', []);
  execute('DELETE FROM projects', []);
});

describe('checkOrphanedStates', () => {
  it('should return empty when all entities are in valid states', () => {
    createTask({
      title: 'Valid Task',
      summary: 'In NEW state',
      priority: Priority.HIGH,
      complexity: 3,
    });
    createFeature({
      name: 'Valid Feature',
      summary: 'In NEW state',
      priority: Priority.HIGH,
    });

    const orphaned = checkOrphanedStates();
    expect(orphaned).toEqual([]);
  });

  it('should detect tasks in states not in pipeline', () => {
    // Insert a task with a state that is not in the configured pipeline
    execute(
      `INSERT INTO tasks (id, title, summary, status, priority, complexity, blocked_by, related_to, version, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['aabbccdd11223344aabbccdd11223344', 'Orphan', 'Orphan task', 'TO_BE_TESTED', 'HIGH', 3, '[]', '[]', 1, new Date().toISOString(), new Date().toISOString()]
    );

    const orphaned = checkOrphanedStates();
    expect(orphaned.length).toBe(1);
    const first = orphaned[0];
    expect(first).toBeDefined();
    expect(first?.entityType).toBe('task');
    expect(first?.status).toBe('TO_BE_TESTED');
    expect(first?.count).toBe(1);
  });

  it('should not flag WILL_NOT_IMPLEMENT as orphaned', () => {
    execute(
      `INSERT INTO tasks (id, title, summary, status, priority, complexity, blocked_by, related_to, version, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['aabbccdd11223344aabbccdd11223345', 'WNI Task', 'Terminated', 'WILL_NOT_IMPLEMENT', 'HIGH', 3, '[]', '[]', 1, new Date().toISOString(), new Date().toISOString()]
    );

    const orphaned = checkOrphanedStates();
    expect(orphaned).toEqual([]);
  });
});

describe('runStartupChecks', () => {
  it('should not throw even with orphaned states', () => {
    execute(
      `INSERT INTO tasks (id, title, summary, status, priority, complexity, blocked_by, related_to, version, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['aabbccdd11223344aabbccdd11223346', 'Bad Task', 'Bad state', 'BOGUS_STATE', 'HIGH', 3, '[]', '[]', 1, new Date().toISOString(), new Date().toISOString()]
    );

    // Should not throw - it's non-fatal
    expect(() => runStartupChecks()).not.toThrow();
  });

  it('should not throw with clean data', () => {
    expect(() => runStartupChecks()).not.toThrow();
  });
});
