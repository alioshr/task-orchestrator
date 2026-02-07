import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import {
  DependencyEntityType,
  DependencyType,
  FeatureStatus,
  Priority,
  TaskStatus,
} from '../domain/types';
import { createProject } from './projects';
import { createFeature, deleteFeature } from './features';
import { createTask } from './tasks';
import {
  createDependency,
  getDependencies,
  getNext,
  getBlocked,
} from './dependencies';
import { getWorkflowState } from '../services/workflow';

beforeEach(() => {
  db.run('DELETE FROM dependencies');
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM sections');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

afterAll(() => {
  db.run('DELETE FROM dependencies');
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM sections');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

// Helper to create a project with two features
function setupFeatures(opts?: { statusA?: FeatureStatus; statusB?: FeatureStatus; priorityA?: Priority; priorityB?: Priority }) {
  const project = createProject({ name: 'Test Project', summary: 'Test' });
  if (!project.success) throw new Error('Failed to create project');

  const featureA = createFeature({
    projectId: project.data.id,
    name: 'Feature A',
    summary: 'First feature',
    status: opts?.statusA ?? FeatureStatus.DRAFT,
    priority: opts?.priorityA ?? Priority.HIGH,
  });
  if (!featureA.success) throw new Error('Failed to create feature A');

  const featureB = createFeature({
    projectId: project.data.id,
    name: 'Feature B',
    summary: 'Second feature',
    status: opts?.statusB ?? FeatureStatus.DRAFT,
    priority: opts?.priorityB ?? Priority.MEDIUM,
  });
  if (!featureB.success) throw new Error('Failed to create feature B');

  return { project: project.data, featureA: featureA.data, featureB: featureB.data };
}

describe('feature-level dependency CRUD', () => {
  it('should create a feature→feature BLOCKS dependency', () => {
    const { featureA, featureB } = setupFeatures();

    const result = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromEntityId).toBe(featureA.id);
      expect(result.data.toEntityId).toBe(featureB.id);
      expect(result.data.entityType).toBe(DependencyEntityType.FEATURE);
      expect(result.data.type).toBe(DependencyType.BLOCKS);
    }
  });

  it('should create a feature→feature IS_BLOCKED_BY dependency', () => {
    const { featureA, featureB } = setupFeatures();

    const result = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.IS_BLOCKED_BY,
      entityType: DependencyEntityType.FEATURE,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe(DependencyType.IS_BLOCKED_BY);
    }
  });

  it('should create a feature→feature RELATES_TO dependency', () => {
    const { featureA, featureB } = setupFeatures();

    const result = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.RELATES_TO,
      entityType: DependencyEntityType.FEATURE,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe(DependencyType.RELATES_TO);
    }
  });

  it('should reject self-dependency for features', () => {
    const { featureA } = setupFeatures();

    const result = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureA.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('SELF_DEPENDENCY');
    }
  });

  it('should reject circular feature dependencies', () => {
    const { featureA, featureB } = setupFeatures();

    const dep1 = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });
    expect(dep1.success).toBe(true);

    const dep2 = createDependency({
      fromEntityId: featureB.id,
      toEntityId: featureA.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    expect(dep2.success).toBe(false);
    if (!dep2.success) {
      expect(dep2.code).toBe('CIRCULAR_DEPENDENCY');
    }
  });

  it('should reject cross-type dependency (task ID with feature entityType)', () => {
    const { featureA, project } = setupFeatures();

    const task = createTask({
      featureId: featureA.id,
      title: 'A task',
      summary: 'Summary',
      priority: Priority.HIGH,
      complexity: 3,
    });
    if (!task.success) throw new Error('Failed to create task');

    // Try to create dep with entityType='feature' but using task ID
    const result = createDependency({
      fromEntityId: task.data.id,
      toEntityId: featureA.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('should reject cross-type dependency (feature ID with task entityType)', () => {
    const { featureA, featureB } = setupFeatures();

    const result = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.TASK,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('should reject duplicate feature dependency', () => {
    const { featureA, featureB } = setupFeatures();

    const dep1 = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });
    expect(dep1.success).toBe(true);

    const dep2 = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    expect(dep2.success).toBe(false);
    if (!dep2.success) {
      expect(dep2.code).toBe('DUPLICATE_DEPENDENCY');
    }
  });
});

describe('getDependencies for features', () => {
  it('should return only feature deps when filtered by entityType', () => {
    const { featureA, featureB } = setupFeatures();

    // Create a task dep and a feature dep using the same feature's ID patterns
    const task1 = createTask({
      featureId: featureA.id,
      title: 'Task 1',
      summary: 'Summary',
      priority: Priority.HIGH,
      complexity: 3,
    });
    const task2 = createTask({
      featureId: featureA.id,
      title: 'Task 2',
      summary: 'Summary',
      priority: Priority.HIGH,
      complexity: 3,
    });
    if (!task1.success || !task2.success) throw new Error('Failed to create tasks');

    createDependency({
      fromEntityId: task1.data.id,
      toEntityId: task2.data.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.TASK,
    });

    createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    const featureDeps = getDependencies(featureA.id, 'both', DependencyEntityType.FEATURE);
    expect(featureDeps.success).toBe(true);
    if (featureDeps.success) {
      expect(featureDeps.data.length).toBe(1);
      expect(featureDeps.data[0]!.entityType).toBe(DependencyEntityType.FEATURE);
    }

    const taskDeps = getDependencies(task1.data.id, 'both', DependencyEntityType.TASK);
    expect(taskDeps.success).toBe(true);
    if (taskDeps.success) {
      expect(taskDeps.data.length).toBe(1);
      expect(taskDeps.data[0]!.entityType).toBe(DependencyEntityType.TASK);
    }
  });
});

describe('getNext for features', () => {
  it('should return the unblocked feature when one is blocked', () => {
    const { featureA, featureB, project } = setupFeatures({
      priorityA: Priority.HIGH,
      priorityB: Priority.HIGH,
    });

    // A blocks B — so getNext should return A
    createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    const result = getNext({
      entityType: DependencyEntityType.FEATURE,
      projectId: project.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
      expect(result.data!.id).toBe(featureA.id);
    }
  });

  it('should return highest priority feature when all are unblocked', () => {
    const { featureA, featureB, project } = setupFeatures({
      priorityA: Priority.LOW,
      priorityB: Priority.HIGH,
    });

    const result = getNext({
      entityType: DependencyEntityType.FEATURE,
      projectId: project.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
      expect(result.data!.id).toBe(featureB.id);
    }
  });

  it('should return blocked feature once blocker is resolved', () => {
    const { featureB, project } = setupFeatures({
      statusA: FeatureStatus.COMPLETED,
      priorityB: Priority.HIGH,
    });

    // featureA is COMPLETED, so it won't appear in getNext (not DRAFT/PLANNING)
    // featureB is DRAFT and unblocked — should be returned
    // Note: featureA being COMPLETED means it's resolved as a blocker
    const result = getNext({
      entityType: DependencyEntityType.FEATURE,
      projectId: project.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
      expect(result.data!.id).toBe(featureB.id);
    }
  });

  it('should not return features in IN_DEVELOPMENT status', () => {
    const project = createProject({ name: 'P', summary: 'S' });
    if (!project.success) throw new Error('Failed to create project');

    const feature = createFeature({
      projectId: project.data.id,
      name: 'Active Feature',
      summary: 'Already in dev',
      status: FeatureStatus.IN_DEVELOPMENT,
      priority: Priority.HIGH,
    });
    if (!feature.success) throw new Error('Failed to create feature');

    const result = getNext({
      entityType: DependencyEntityType.FEATURE,
      projectId: project.data.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });
});

describe('getBlocked for features', () => {
  it('should return features with BLOCKED status', () => {
    const { project } = setupFeatures();

    const blocked = createFeature({
      projectId: project.id,
      name: 'Blocked Feature',
      summary: 'This is blocked',
      status: FeatureStatus.BLOCKED,
      priority: Priority.HIGH,
    });
    if (!blocked.success) throw new Error('Failed to create feature');

    const result = getBlocked({
      entityType: DependencyEntityType.FEATURE,
      projectId: project.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const blockedIds = result.data.map(f => f.id);
      expect(blockedIds).toContain(blocked.data.id);
    }
  });

  it('should return features with unresolved BLOCKS dependencies', () => {
    const { featureA, featureB, project } = setupFeatures({
      statusA: FeatureStatus.IN_DEVELOPMENT,
      statusB: FeatureStatus.DRAFT,
    });

    // A blocks B, and A is not resolved
    createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    const result = getBlocked({
      entityType: DependencyEntityType.FEATURE,
      projectId: project.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const blockedIds = result.data.map(f => f.id);
      expect(blockedIds).toContain(featureB.id);
      expect(blockedIds).not.toContain(featureA.id);
    }
  });

  it('should not return features whose blockers are all resolved', () => {
    const { featureA, featureB, project } = setupFeatures({
      statusA: FeatureStatus.COMPLETED,
      statusB: FeatureStatus.DRAFT,
    });

    createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    const result = getBlocked({
      entityType: DependencyEntityType.FEATURE,
      projectId: project.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const blockedIds = result.data.map(f => f.id);
      expect(blockedIds).not.toContain(featureB.id);
    }
  });
});

describe('workflow state for features with dependencies', () => {
  it('should return blockingDependencies for a feature with unresolved blockers', () => {
    const { featureA, featureB } = setupFeatures({
      statusA: FeatureStatus.IN_DEVELOPMENT,
      statusB: FeatureStatus.DRAFT,
    });

    createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    const result = getWorkflowState('feature', featureB.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockingDependencies).toBeDefined();
      expect(result.data.blockingDependencies?.length).toBe(1);
      expect(result.data.blockingDependencies?.[0]?.entityId).toBe(featureA.id);
      expect(result.data.blockingDependencies?.[0]?.entityName).toBe('Feature A');
      expect(result.data.blockingDependencies?.[0]?.status).toBe('IN_DEVELOPMENT');
    }
  });

  it('should not return blockingDependencies when all blockers are resolved', () => {
    const { featureA, featureB } = setupFeatures({
      statusA: FeatureStatus.COMPLETED,
      statusB: FeatureStatus.DRAFT,
    });

    createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });

    const result = getWorkflowState('feature', featureB.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockingDependencies).toBeUndefined();
    }
  });
});

describe('feature dependency cleanup on deleteFeature', () => {
  it('should remove dependency rows when a feature is deleted', () => {
    const { featureA, featureB } = setupFeatures();

    const dep = createDependency({
      fromEntityId: featureA.id,
      toEntityId: featureB.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.FEATURE,
    });
    expect(dep.success).toBe(true);

    // Delete featureA
    const deleteResult = deleteFeature(featureA.id);
    expect(deleteResult.success).toBe(true);

    // Verify the dependency row is gone by querying remaining featureB
    const depsResult = getDependencies(featureB.id, 'both', DependencyEntityType.FEATURE);
    expect(depsResult.success).toBe(true);
    if (depsResult.success) {
      expect(depsResult.data.length).toBe(0);
    }
  });
});

describe('task dependency regression', () => {
  it('should still create and query task dependencies', () => {
    const feature = createFeature({
      name: 'Test Feature',
      summary: 'Summary',
      priority: Priority.HIGH,
    });
    if (!feature.success) throw new Error('Failed to create feature');

    const task1 = createTask({
      featureId: feature.data.id,
      title: 'Task 1',
      summary: 'Summary',
      priority: Priority.HIGH,
      complexity: 3,
    });
    const task2 = createTask({
      featureId: feature.data.id,
      title: 'Task 2',
      summary: 'Summary',
      priority: Priority.HIGH,
      complexity: 3,
    });
    if (!task1.success || !task2.success) throw new Error('Failed to create tasks');

    const dep = createDependency({
      fromEntityId: task1.data.id,
      toEntityId: task2.data.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.TASK,
    });
    expect(dep.success).toBe(true);

    const deps = getDependencies(task1.data.id, 'both', DependencyEntityType.TASK);
    expect(deps.success).toBe(true);
    if (deps.success) {
      expect(deps.data.length).toBe(1);
      expect(deps.data[0]!.entityType).toBe(DependencyEntityType.TASK);
    }
  });

  it('getNext for tasks still works', () => {
    const task1 = createTask({
      title: 'Blocked',
      summary: 'S',
      priority: Priority.HIGH,
      complexity: 3,
      status: TaskStatus.PENDING,
    });
    const task2 = createTask({
      title: 'Free',
      summary: 'S',
      priority: Priority.HIGH,
      complexity: 3,
      status: TaskStatus.PENDING,
    });
    if (!task1.success || !task2.success) throw new Error('Failed to create tasks');

    createDependency({
      fromEntityId: task1.data.id,
      toEntityId: task2.data.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.TASK,
    });

    const result = getNext({ entityType: DependencyEntityType.TASK });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
      expect(result.data!.id).toBe(task1.data.id);
    }
  });

  it('getBlocked for tasks still works', () => {
    const task1 = createTask({
      title: 'Blocker',
      summary: 'S',
      priority: Priority.HIGH,
      complexity: 3,
      status: TaskStatus.IN_PROGRESS,
    });
    const task2 = createTask({
      title: 'Blocked',
      summary: 'S',
      priority: Priority.MEDIUM,
      complexity: 3,
      status: TaskStatus.BLOCKED,
    });
    if (!task1.success || !task2.success) throw new Error('Failed to create tasks');

    createDependency({
      fromEntityId: task1.data.id,
      toEntityId: task2.data.id,
      type: DependencyType.BLOCKS,
      entityType: DependencyEntityType.TASK,
    });

    const result = getBlocked({ entityType: DependencyEntityType.TASK });

    expect(result.success).toBe(true);
    if (result.success) {
      const blockedIds = result.data.map((t: any) => t.id);
      expect(blockedIds).toContain(task2.data.id);
    }
  });
});
