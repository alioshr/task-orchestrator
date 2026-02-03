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

// Setup test database
beforeEach(() => {
  // Clean up tables before each test
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

afterAll(() => {
  // Final cleanup
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
