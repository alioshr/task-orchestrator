import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { FeatureStatus, Priority } from '../domain/types';
import {
  createFeature,
  getFeature,
  updateFeature,
  deleteFeature,
  searchFeatures,
  getFeatureOverview
} from './features';
import { createTask, getTask } from './tasks';

// Setup test database
beforeEach(() => {
  // Clean up tables before each test
  db.run('DELETE FROM dependencies');
  db.run('DELETE FROM sections');
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

afterAll(() => {
  // Final cleanup
  db.run('DELETE FROM dependencies');
  db.run('DELETE FROM sections');
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

describe('updateFeature - Status Transition Validation', () => {
  it('should allow valid transition from DRAFT to PLANNING', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.DRAFT
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.PLANNING,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.PLANNING);
      expect(result.data.version).toBe(2);
    }
  });

  it('should allow valid transition from PLANNING to IN_DEVELOPMENT', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.PLANNING
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.IN_DEVELOPMENT,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.IN_DEVELOPMENT);
    }
  });

  it('should allow valid transition from IN_DEVELOPMENT to TESTING', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.IN_DEVELOPMENT
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.TESTING,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.TESTING);
    }
  });

  it('should reject invalid transition from DRAFT to IN_DEVELOPMENT', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.DRAFT
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.IN_DEVELOPMENT,
      version: 1
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('Invalid status transition');
      expect(result.error).toContain('DRAFT');
      expect(result.error).toContain('IN_DEVELOPMENT');
      expect(result.error).toContain('Allowed transitions: PLANNING');
    }
  });

  it('should reject invalid transition from PLANNING to COMPLETED', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.PLANNING
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.COMPLETED,
      version: 1
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('Invalid status transition');
      expect(result.error).toContain('PLANNING');
      expect(result.error).toContain('COMPLETED');
    }
  });

  it('should reject transition from terminal status ARCHIVED', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.COMPLETED
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    // First transition to ARCHIVED
    const archived = updateFeature(created.data.id, {
      status: FeatureStatus.ARCHIVED,
      version: 1
    });

    expect(archived.success).toBe(true);
    if (!archived.success) return;

    // Try to transition from ARCHIVED (terminal status)
    const result = updateFeature(created.data.id, {
      status: FeatureStatus.PLANNING,
      version: 2
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('Cannot transition from terminal status');
      expect(result.error).toContain('ARCHIVED');
    }
  });

  it('should allow valid transition from TESTING to VALIDATING', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.TESTING
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.VALIDATING,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.VALIDATING);
    }
  });

  it('should allow valid transition from VALIDATING to PENDING_REVIEW', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.VALIDATING
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.PENDING_REVIEW,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.PENDING_REVIEW);
    }
  });

  it('should allow valid transition from PENDING_REVIEW to DEPLOYED', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.PENDING_REVIEW
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.DEPLOYED,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.DEPLOYED);
    }
  });

  it('should allow valid transition from DEPLOYED to COMPLETED', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.DEPLOYED
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.COMPLETED,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.COMPLETED);
    }
  });

  it('should allow valid transition from COMPLETED to ARCHIVED', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.COMPLETED
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.ARCHIVED,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.ARCHIVED);
    }
  });

  it('should allow valid transition from IN_DEVELOPMENT to BLOCKED', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.IN_DEVELOPMENT
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.BLOCKED,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.BLOCKED);
    }
  });

  it('should allow valid transition from BLOCKED to IN_DEVELOPMENT', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.BLOCKED
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.IN_DEVELOPMENT,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.IN_DEVELOPMENT);
    }
  });

  it('should allow valid transition from IN_DEVELOPMENT to ON_HOLD', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.IN_DEVELOPMENT
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.ON_HOLD,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.ON_HOLD);
    }
  });

  it('should allow valid transition from ON_HOLD to PLANNING', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.ON_HOLD
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.PLANNING,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.PLANNING);
    }
  });

  it('should allow update without status change', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.DRAFT
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      name: 'Updated Name',
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
      expect(result.data.status).toBe(FeatureStatus.DRAFT);
    }
  });

  it('should allow update with same status (no transition)', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.IN_DEVELOPMENT
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.IN_DEVELOPMENT,
      name: 'Updated Name',
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.IN_DEVELOPMENT);
      expect(result.data.name).toBe('Updated Name');
    }
  });

  it('should allow transition back from VALIDATING to IN_DEVELOPMENT', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.VALIDATING
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.IN_DEVELOPMENT,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.IN_DEVELOPMENT);
    }
  });

  it('should allow transition back from TESTING to IN_DEVELOPMENT', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.TESTING
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.IN_DEVELOPMENT,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.IN_DEVELOPMENT);
    }
  });

  it('should allow transition back from PENDING_REVIEW to IN_DEVELOPMENT', () => {
    const created = createFeature({
      name: 'Test Feature',
      summary: 'Test summary',
      priority: Priority.MEDIUM,
      status: FeatureStatus.PENDING_REVIEW
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      status: FeatureStatus.IN_DEVELOPMENT,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(FeatureStatus.IN_DEVELOPMENT);
    }
  });
});

describe('deleteFeature - Cascade Delete', () => {
  it('should delete a feature without children', () => {
    const feature = createFeature({
      name: 'Empty Feature',
      summary: 'No children',
      priority: Priority.MEDIUM
    });
    expect(feature.success).toBe(true);
    if (!feature.success) return;

    const result = deleteFeature(feature.data.id);

    expect(result.success).toBe(true);
    expect(getFeature(feature.data.id).success).toBe(false);
  });

  it('should fail when feature has tasks and cascade is not set', () => {
    const feature = createFeature({
      name: 'Feature with Tasks',
      summary: 'Has children',
      priority: Priority.HIGH
    });
    expect(feature.success).toBe(true);
    if (!feature.success) return;

    const task = createTask({
      featureId: feature.data.id,
      title: 'Child Task',
      summary: 'A child',
      priority: Priority.HIGH,
      complexity: 3
    });
    expect(task.success).toBe(true);

    const result = deleteFeature(feature.data.id);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('HAS_CHILDREN');
      expect(result.error).toContain('1 task');
      expect(result.error).toContain('cascade: true');
    }
  });

  it('should delete feature with tasks when cascade is true', () => {
    const feature = createFeature({
      name: 'Feature to Cascade',
      summary: 'Will be cascade deleted',
      priority: Priority.HIGH
    });
    expect(feature.success).toBe(true);
    if (!feature.success) return;

    const task1 = createTask({
      featureId: feature.data.id,
      title: 'Task 1',
      summary: 'First task',
      priority: Priority.HIGH,
      complexity: 3
    });
    expect(task1.success).toBe(true);
    if (!task1.success) return;

    const task2 = createTask({
      featureId: feature.data.id,
      title: 'Task 2',
      summary: 'Second task',
      priority: Priority.MEDIUM,
      complexity: 2
    });
    expect(task2.success).toBe(true);
    if (!task2.success) return;

    const result = deleteFeature(feature.data.id, { cascade: true });

    expect(result.success).toBe(true);

    // Verify feature is deleted
    expect(getFeature(feature.data.id).success).toBe(false);

    // Verify tasks are deleted
    expect(getTask(task1.data.id).success).toBe(false);
    expect(getTask(task2.data.id).success).toBe(false);
  });

  it('should delete feature and task tags when cascade is true', () => {
    const feature = createFeature({
      name: 'Tagged Feature',
      summary: 'Has tags',
      priority: Priority.HIGH,
      tags: ['feature-tag']
    });
    expect(feature.success).toBe(true);
    if (!feature.success) return;

    const task = createTask({
      featureId: feature.data.id,
      title: 'Tagged Task',
      summary: 'Has tags',
      priority: Priority.HIGH,
      complexity: 3,
      tags: ['task-tag']
    });
    expect(task.success).toBe(true);
    if (!task.success) return;

    const result = deleteFeature(feature.data.id, { cascade: true });

    expect(result.success).toBe(true);

    // Verify all tags are deleted
    const featureTags = db.query('SELECT * FROM entity_tags WHERE entity_id = ?').all(feature.data.id);
    const taskTags = db.query('SELECT * FROM entity_tags WHERE entity_id = ?').all(task.data.id);

    expect(featureTags.length).toBe(0);
    expect(taskTags.length).toBe(0);
  });

  it('should return error for non-existent feature', () => {
    const result = deleteFeature('non-existent-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});
