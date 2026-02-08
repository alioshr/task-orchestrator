import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { Priority } from '../domain/types';
import {
  createFeature,
  getFeature,
  updateFeature,
  deleteFeature,
  searchFeatures
} from './features';
import { createProject } from './projects';
import { createTask, getTask } from './tasks';

function cleanup() {
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
// createFeature
// ============================================================================

describe('createFeature', () => {
  it('should create a feature with default status and version', () => {
    const result = createFeature({
      name: 'Auth Module',
      summary: 'Implement authentication',
      priority: Priority.HIGH
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.id).toBeDefined();
    expect(result.data.name).toBe('Auth Module');
    expect(result.data.summary).toBe('Implement authentication');
    expect(result.data.status).toBe('NEW');
    expect(result.data.priority).toBe(Priority.HIGH);
    expect(result.data.version).toBe(1);
    expect(result.data.blockedBy).toEqual([]);
    expect(result.data.relatedTo).toEqual([]);
    expect(result.data.tags).toEqual([]);
    expect(result.data.createdAt).toBeInstanceOf(Date);
    expect(result.data.modifiedAt).toBeInstanceOf(Date);
  });

  it('should create a feature with a specified priority', () => {
    const result = createFeature({
      name: 'Low Priority Feature',
      summary: 'Not urgent',
      priority: Priority.LOW
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.priority).toBe(Priority.LOW);
  });

  it('should create a feature with tags', () => {
    const result = createFeature({
      name: 'Tagged Feature',
      summary: 'Has tags',
      priority: Priority.MEDIUM,
      tags: ['backend', 'api']
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.tags).toContain('backend');
    expect(result.data.tags).toContain('api');
    expect(result.data.tags?.length).toBe(2);
  });

  it('should create a feature under a project', () => {
    const project = createProject({
      name: 'Parent Project',
      summary: 'The parent'
    });
    expect(project.success).toBe(true);
    if (!project.success) return;

    const result = createFeature({
      projectId: project.data.id,
      name: 'Child Feature',
      summary: 'Belongs to project',
      priority: Priority.HIGH
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.projectId).toBe(project.data.id);
  });

  it('should reject empty feature name', () => {
    const result = createFeature({
      name: '   ',
      summary: 'Valid summary',
      priority: Priority.MEDIUM
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('name cannot be empty');
    }
  });

  it('should reject empty feature summary', () => {
    const result = createFeature({
      name: 'Valid Name',
      summary: '   ',
      priority: Priority.MEDIUM
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('summary cannot be empty');
    }
  });

  it('should build a search vector from name, summary, and description', () => {
    const result = createFeature({
      name: 'Searchable Feature',
      summary: 'Findable summary',
      description: 'Detailed description content',
      priority: Priority.MEDIUM
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.searchVector).toBeDefined();
    expect(result.data.searchVector).toContain('searchable');
    expect(result.data.searchVector).toContain('findable');
  });
});

// ============================================================================
// getFeature
// ============================================================================

describe('getFeature', () => {
  it('should retrieve an existing feature by id', () => {
    const created = createFeature({
      name: 'Retrievable',
      summary: 'Can be fetched',
      priority: Priority.HIGH
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = getFeature(created.data.id);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.id).toBe(created.data.id);
    expect(result.data.name).toBe('Retrievable');
    expect(result.data.summary).toBe('Can be fetched');
    expect(result.data.priority).toBe(Priority.HIGH);
  });

  it('should return NOT_FOUND for a non-existent id', () => {
    const result = getFeature('non-existent-id-12345');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Feature not found');
    }
  });

  it('should load tags with the feature', () => {
    const created = createFeature({
      name: 'Tagged',
      summary: 'Has tags',
      priority: Priority.MEDIUM,
      tags: ['alpha', 'beta']
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = getFeature(created.data.id);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.tags).toContain('alpha');
    expect(result.data.tags).toContain('beta');
  });
});

// ============================================================================
// updateFeature
// ============================================================================

describe('updateFeature', () => {
  it('should update the feature name', () => {
    const created = createFeature({
      name: 'Original',
      summary: 'Original summary',
      priority: Priority.MEDIUM
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      name: 'Updated Name',
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.name).toBe('Updated Name');
    expect(result.data.summary).toBe('Original summary');
    expect(result.data.version).toBe(2);
  });

  it('should update the feature summary', () => {
    const created = createFeature({
      name: 'Feature',
      summary: 'Old summary',
      priority: Priority.MEDIUM
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      summary: 'New summary',
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.summary).toBe('New summary');
    expect(result.data.version).toBe(2);
  });

  it('should update the feature description', () => {
    const created = createFeature({
      name: 'Feature',
      summary: 'Summary',
      priority: Priority.MEDIUM
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      description: 'Added description',
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.description).toBe('Added description');
    expect(result.data.version).toBe(2);
  });

  it('should update the feature priority', () => {
    const created = createFeature({
      name: 'Feature',
      summary: 'Summary',
      priority: Priority.LOW
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      priority: Priority.HIGH,
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.priority).toBe(Priority.HIGH);
    expect(result.data.version).toBe(2);
  });

  it('should update the relatedTo field', () => {
    const created = createFeature({
      name: 'Feature',
      summary: 'Summary',
      priority: Priority.MEDIUM
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      relatedTo: ['abc123', 'def456'],
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.relatedTo).toEqual(['abc123', 'def456']);
    expect(result.data.version).toBe(2);
  });

  it('should update tags', () => {
    const created = createFeature({
      name: 'Feature',
      summary: 'Summary',
      priority: Priority.MEDIUM,
      tags: ['old-tag']
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      tags: ['new-tag1', 'new-tag2'],
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.tags).toContain('new-tag1');
    expect(result.data.tags).toContain('new-tag2');
    expect(result.data.tags).not.toContain('old-tag');
  });

  it('should reject a version conflict (optimistic locking)', () => {
    const created = createFeature({
      name: 'Feature',
      summary: 'Summary',
      priority: Priority.MEDIUM
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      name: 'Should Fail',
      version: 999
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CONFLICT');
      expect(result.error).toContain('Version conflict');
    }
  });

  it('should return NOT_FOUND for a non-existent feature', () => {
    const result = updateFeature('non-existent-id', {
      name: 'Does not matter',
      version: 1
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('should update modifiedAt timestamp', () => {
    const created = createFeature({
      name: 'Feature',
      summary: 'Summary',
      priority: Priority.MEDIUM
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const originalModifiedAt = created.data.modifiedAt;

    const result = updateFeature(created.data.id, {
      name: 'Updated',
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.modifiedAt.getTime()).toBeGreaterThanOrEqual(
      originalModifiedAt.getTime()
    );
  });

  it('should rebuild search vector on text field update', () => {
    const created = createFeature({
      name: 'Original',
      summary: 'Original summary',
      priority: Priority.MEDIUM
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateFeature(created.data.id, {
      name: 'Refactored Searchable',
      version: 1
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.searchVector).toContain('refactored');
    expect(result.data.searchVector).toContain('searchable');
  });
});

// ============================================================================
// deleteFeature
// ============================================================================

describe('deleteFeature', () => {
  it('should delete an existing feature with no children', () => {
    const created = createFeature({
      name: 'To Delete',
      summary: 'Will be removed',
      priority: Priority.LOW
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteFeature(created.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }

    const getResult = getFeature(created.data.id);
    expect(getResult.success).toBe(false);
  });

  it('should delete feature tags when deleting the feature', () => {
    const created = createFeature({
      name: 'Tagged Feature',
      summary: 'Has tags',
      priority: Priority.MEDIUM,
      tags: ['tag1', 'tag2']
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteFeature(created.data.id);

    expect(result.success).toBe(true);

    const rows = db
      .query('SELECT * FROM entity_tags WHERE entity_id = ? AND entity_type = ?')
      .all(created.data.id, 'FEATURE');
    expect(rows.length).toBe(0);
  });

  it('should return NOT_FOUND for a non-existent feature', () => {
    const result = deleteFeature('non-existent-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
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
      summary: 'A task',
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

  it('should cascade delete tasks when cascade is true', () => {
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

    expect(getFeature(feature.data.id).success).toBe(false);
    expect(getTask(task1.data.id).success).toBe(false);
    expect(getTask(task2.data.id).success).toBe(false);
  });

  it('should delete sections, tags, and child entity tags when cascade is true', () => {
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
      priority: Priority.MEDIUM,
      complexity: 3,
      tags: ['task-tag']
    });
    expect(task.success).toBe(true);
    if (!task.success) return;

    const result = deleteFeature(feature.data.id, { cascade: true });

    expect(result.success).toBe(true);

    const featureTags = db
      .query('SELECT * FROM entity_tags WHERE entity_id = ?')
      .all(feature.data.id);
    const taskTags = db
      .query('SELECT * FROM entity_tags WHERE entity_id = ?')
      .all(task.data.id);

    expect(featureTags.length).toBe(0);
    expect(taskTags.length).toBe(0);
  });
});

// ============================================================================
// searchFeatures
// ============================================================================

describe('searchFeatures', () => {
  it('should return all features when no filters are provided', () => {
    createFeature({ name: 'Feature 1', summary: 'Summary 1', priority: Priority.HIGH });
    createFeature({ name: 'Feature 2', summary: 'Summary 2', priority: Priority.LOW });

    const result = searchFeatures({});

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(2);
  });

  it('should search by text query', () => {
    createFeature({ name: 'Unique Feature', summary: 'Summary', priority: Priority.HIGH });
    createFeature({ name: 'Another Feature', summary: 'Summary', priority: Priority.LOW });

    const result = searchFeatures({ query: 'unique' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(1);
    expect(result.data[0]!.name).toBe('Unique Feature');
  });

  it('should filter by status', () => {
    createFeature({
      name: 'Planning Feature',
      summary: 'Summary',
      priority: Priority.HIGH,
      status: 'NEW'
    });
    createFeature({
      name: 'Active Feature',
      summary: 'Summary',
      priority: Priority.MEDIUM,
      status: 'ACTIVE'
    });

    const result = searchFeatures({ status: 'ACTIVE' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(1);
    expect(result.data[0]!.status).toBe('ACTIVE');
  });

  it('should filter by negated status', () => {
    createFeature({
      name: 'Open Feature',
      summary: 'Summary',
      priority: Priority.HIGH,
      status: 'NEW'
    });
    createFeature({
      name: 'Closed Feature',
      summary: 'Summary',
      priority: Priority.LOW,
      status: 'CLOSED'
    });

    const result = searchFeatures({ status: '!CLOSED' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(1);
    expect(result.data[0]!.status).toBe('NEW');
  });

  it('should filter by priority', () => {
    createFeature({ name: 'High', summary: 'Summary', priority: Priority.HIGH });
    createFeature({ name: 'Low', summary: 'Summary', priority: Priority.LOW });

    const result = searchFeatures({ priority: 'HIGH' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(1);
    expect(result.data[0]!.name).toBe('High');
  });

  it('should filter by tags', () => {
    createFeature({
      name: 'Backend Feature',
      summary: 'Summary',
      priority: Priority.HIGH,
      tags: ['backend', 'api']
    });
    createFeature({
      name: 'Frontend Feature',
      summary: 'Summary',
      priority: Priority.MEDIUM,
      tags: ['frontend', 'ui']
    });

    const result = searchFeatures({ tags: 'backend' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(1);
    expect(result.data[0]!.name).toBe('Backend Feature');
  });

  it('should respect the limit parameter', () => {
    createFeature({ name: 'Feature 1', summary: 'Summary', priority: Priority.HIGH });
    createFeature({ name: 'Feature 2', summary: 'Summary', priority: Priority.MEDIUM });
    createFeature({ name: 'Feature 3', summary: 'Summary', priority: Priority.LOW });

    const result = searchFeatures({ limit: 2 });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(2);
  });

  it('should respect the offset parameter', () => {
    createFeature({ name: 'Feature 1', summary: 'Summary', priority: Priority.HIGH });
    createFeature({ name: 'Feature 2', summary: 'Summary', priority: Priority.MEDIUM });
    createFeature({ name: 'Feature 3', summary: 'Summary', priority: Priority.LOW });

    const result = searchFeatures({ limit: 1, offset: 1 });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(1);
  });

  it('should return empty array when no matches', () => {
    createFeature({ name: 'Feature', summary: 'Summary', priority: Priority.MEDIUM });

    const result = searchFeatures({ query: 'nonexistent' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.length).toBe(0);
  });

  it('should order results by created_at DESC', () => {
    const first = createFeature({ name: 'First', summary: 'Summary', priority: Priority.HIGH });
    const second = createFeature({ name: 'Second', summary: 'Summary', priority: Priority.LOW });

    const result = searchFeatures({});

    expect(result.success).toBe(true);
    if (result.success && first.success && second.success) {
      expect(result.data[0]!.id).toBe(second.data.id);
      expect(result.data[1]!.id).toBe(first.data.id);
    }
  });
});
