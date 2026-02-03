import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { getWorkflowState } from './workflow';
import { createProject } from '../repos/projects';
import { createFeature } from '../repos/features';
import { createTask } from '../repos/tasks';
import { createDependency } from '../repos/dependencies';
import { ProjectStatus, FeatureStatus, TaskStatus, Priority, DependencyType } from '../domain/types';

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

describe('getWorkflowState - projects', () => {
  it('should return workflow state for a project', () => {
    const projectResult = createProject({
      name: 'Test Project',
      summary: 'Test summary',
      status: ProjectStatus.PLANNING
    });

    expect(projectResult.success).toBe(true);
    if (!projectResult.success) return;

    const result = getWorkflowState('project', projectResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerType).toBe('project');
      expect(result.data.id).toBe(projectResult.data.id);
      expect(result.data.currentStatus).toBe('PLANNING');
      expect(result.data.allowedTransitions).toContain('IN_DEVELOPMENT');
      expect(result.data.allowedTransitions).toContain('ON_HOLD');
      expect(result.data.isTerminal).toBe(false);
    }
  });

  it('should mark archived project as terminal', () => {
    const projectResult = createProject({
      name: 'Archived Project',
      summary: 'Test summary',
      status: ProjectStatus.ARCHIVED
    });

    expect(projectResult.success).toBe(true);
    if (!projectResult.success) return;

    const result = getWorkflowState('project', projectResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isTerminal).toBe(true);
      expect(result.data.allowedTransitions).toEqual([]);
    }
  });

  it('should return error for non-existent project', () => {
    const result = getWorkflowState('project', 'non-existent-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});

describe('getWorkflowState - features', () => {
  it('should return workflow state for a feature', () => {
    const featureResult = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      status: FeatureStatus.IN_DEVELOPMENT,
      priority: Priority.HIGH
    });

    expect(featureResult.success).toBe(true);
    if (!featureResult.success) return;

    const result = getWorkflowState('feature', featureResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerType).toBe('feature');
      expect(result.data.currentStatus).toBe('IN_DEVELOPMENT');
      expect(result.data.allowedTransitions).toContain('TESTING');
      expect(result.data.allowedTransitions).toContain('BLOCKED');
      expect(result.data.isTerminal).toBe(false);
    }
  });

  it('should detect cascade event when all tasks are complete', () => {
    const featureResult = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.HIGH
    });

    expect(featureResult.success).toBe(true);
    if (!featureResult.success) return;

    const task1Result = createTask({
      featureId: featureResult.data.id,
      title: 'Task 1',
      summary: 'Summary 1',
      status: TaskStatus.COMPLETED,
      priority: Priority.HIGH,
      complexity: 5
    });

    const task2Result = createTask({
      featureId: featureResult.data.id,
      title: 'Task 2',
      summary: 'Summary 2',
      status: TaskStatus.CANCELLED,
      priority: Priority.MEDIUM,
      complexity: 3
    });

    expect(task1Result.success).toBe(true);
    expect(task2Result.success).toBe(true);

    const result = getWorkflowState('feature', featureResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cascadeEvents).toBeDefined();
      expect(result.data.cascadeEvents).toContain('all_tasks_complete');
    }
  });

  it('should detect cascade event when first task is started', () => {
    const featureResult = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.HIGH
    });

    expect(featureResult.success).toBe(true);
    if (!featureResult.success) return;

    const task1Result = createTask({
      featureId: featureResult.data.id,
      title: 'Task 1',
      summary: 'Summary 1',
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      complexity: 5
    });

    const task2Result = createTask({
      featureId: featureResult.data.id,
      title: 'Task 2',
      summary: 'Summary 2',
      status: TaskStatus.PENDING,
      priority: Priority.MEDIUM,
      complexity: 3
    });

    expect(task1Result.success).toBe(true);
    expect(task2Result.success).toBe(true);

    const result = getWorkflowState('feature', featureResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cascadeEvents).toBeDefined();
      expect(result.data.cascadeEvents).toContain('first_task_started');
    }
  });

  it('should not detect cascade events when all tasks are pending', () => {
    const featureResult = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.HIGH
    });

    expect(featureResult.success).toBe(true);
    if (!featureResult.success) return;

    const task1Result = createTask({
      featureId: featureResult.data.id,
      title: 'Task 1',
      summary: 'Summary 1',
      status: TaskStatus.PENDING,
      priority: Priority.HIGH,
      complexity: 5
    });

    expect(task1Result.success).toBe(true);

    const result = getWorkflowState('feature', featureResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cascadeEvents).toBeUndefined();
    }
  });

  it('should mark archived feature as terminal', () => {
    const featureResult = createFeature({
      name: 'Archived Feature',
      summary: 'Test summary',
      status: FeatureStatus.ARCHIVED,
      priority: Priority.LOW
    });

    expect(featureResult.success).toBe(true);
    if (!featureResult.success) return;

    const result = getWorkflowState('feature', featureResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isTerminal).toBe(true);
      expect(result.data.allowedTransitions).toEqual([]);
    }
  });
});

describe('getWorkflowState - tasks', () => {
  it('should return workflow state for a task', () => {
    const taskResult = createTask({
      title: 'Test Task',
      summary: 'Test summary',
      status: TaskStatus.PENDING,
      priority: Priority.HIGH,
      complexity: 5
    });

    expect(taskResult.success).toBe(true);
    if (!taskResult.success) return;

    const result = getWorkflowState('task', taskResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerType).toBe('task');
      expect(result.data.currentStatus).toBe('PENDING');
      expect(result.data.allowedTransitions).toContain('IN_PROGRESS');
      expect(result.data.allowedTransitions).toContain('BLOCKED');
      expect(result.data.isTerminal).toBe(false);
    }
  });

  it('should detect blocking dependencies for a task', () => {
    const task1Result = createTask({
      title: 'Blocking Task',
      summary: 'This blocks another task',
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      complexity: 5
    });

    const task2Result = createTask({
      title: 'Blocked Task',
      summary: 'This is blocked',
      status: TaskStatus.BLOCKED,
      priority: Priority.MEDIUM,
      complexity: 3
    });

    expect(task1Result.success).toBe(true);
    expect(task2Result.success).toBe(true);
    if (!task1Result.success || !task2Result.success) return;

    const depResult = createDependency({
      fromTaskId: task1Result.data.id,
      toTaskId: task2Result.data.id,
      type: DependencyType.BLOCKS
    });

    expect(depResult.success).toBe(true);

    const result = getWorkflowState('task', task2Result.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockingDependencies).toBeDefined();
      expect(result.data.blockingDependencies?.length).toBe(1);
      expect(result.data.blockingDependencies?.[0]?.taskId).toBe(task1Result.data.id);
      expect(result.data.blockingDependencies?.[0]?.taskTitle).toBe('Blocking Task');
      expect(result.data.blockingDependencies?.[0]?.status).toBe('IN_PROGRESS');
    }
  });

  it('should not include completed blocking dependencies', () => {
    const task1Result = createTask({
      title: 'Completed Task',
      summary: 'This is completed',
      status: TaskStatus.COMPLETED,
      priority: Priority.HIGH,
      complexity: 5
    });

    const task2Result = createTask({
      title: 'Ready Task',
      summary: 'This should be ready',
      status: TaskStatus.PENDING,
      priority: Priority.MEDIUM,
      complexity: 3
    });

    expect(task1Result.success).toBe(true);
    expect(task2Result.success).toBe(true);
    if (!task1Result.success || !task2Result.success) return;

    const depResult = createDependency({
      fromTaskId: task1Result.data.id,
      toTaskId: task2Result.data.id,
      type: DependencyType.BLOCKS
    });

    expect(depResult.success).toBe(true);

    const result = getWorkflowState('task', task2Result.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockingDependencies).toBeUndefined();
    }
  });

  it('should not include cancelled blocking dependencies', () => {
    const task1Result = createTask({
      title: 'Cancelled Task',
      summary: 'This is cancelled',
      status: TaskStatus.CANCELLED,
      priority: Priority.HIGH,
      complexity: 5
    });

    const task2Result = createTask({
      title: 'Ready Task',
      summary: 'This should be ready',
      status: TaskStatus.PENDING,
      priority: Priority.MEDIUM,
      complexity: 3
    });

    expect(task1Result.success).toBe(true);
    expect(task2Result.success).toBe(true);
    if (!task1Result.success || !task2Result.success) return;

    const depResult = createDependency({
      fromTaskId: task1Result.data.id,
      toTaskId: task2Result.data.id,
      type: DependencyType.BLOCKS
    });

    expect(depResult.success).toBe(true);

    const result = getWorkflowState('task', task2Result.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockingDependencies).toBeUndefined();
    }
  });

  it('should mark completed task as terminal', () => {
    const taskResult = createTask({
      title: 'Completed Task',
      summary: 'Test summary',
      status: TaskStatus.COMPLETED,
      priority: Priority.LOW,
      complexity: 2
    });

    expect(taskResult.success).toBe(true);
    if (!taskResult.success) return;

    const result = getWorkflowState('task', taskResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isTerminal).toBe(true);
      expect(result.data.allowedTransitions).toEqual([]);
    }
  });

  it('should handle tasks with multiple blocking dependencies', () => {
    const blocker1Result = createTask({
      title: 'Blocker 1',
      summary: 'First blocker',
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      complexity: 5
    });

    const blocker2Result = createTask({
      title: 'Blocker 2',
      summary: 'Second blocker',
      status: TaskStatus.PENDING,
      priority: Priority.HIGH,
      complexity: 4
    });

    const blockedTaskResult = createTask({
      title: 'Blocked Task',
      summary: 'Blocked by multiple',
      status: TaskStatus.BLOCKED,
      priority: Priority.MEDIUM,
      complexity: 3
    });

    expect(blocker1Result.success).toBe(true);
    expect(blocker2Result.success).toBe(true);
    expect(blockedTaskResult.success).toBe(true);
    if (!blocker1Result.success || !blocker2Result.success || !blockedTaskResult.success) return;

    const dep1Result = createDependency({
      fromTaskId: blocker1Result.data.id,
      toTaskId: blockedTaskResult.data.id,
      type: DependencyType.BLOCKS
    });

    const dep2Result = createDependency({
      fromTaskId: blocker2Result.data.id,
      toTaskId: blockedTaskResult.data.id,
      type: DependencyType.BLOCKS
    });

    expect(dep1Result.success).toBe(true);
    expect(dep2Result.success).toBe(true);

    const result = getWorkflowState('task', blockedTaskResult.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockingDependencies).toBeDefined();
      expect(result.data.blockingDependencies?.length).toBe(2);
    }
  });
});
