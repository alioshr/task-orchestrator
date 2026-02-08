import { describe, it, expect, beforeAll } from 'bun:test';
import { getWorkflowState } from './workflow';
import { initConfig, resetConfig } from '../config';

// Workflow service tests.
// DB-dependent integration tests will be added in Phase 4 after repos are updated.

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

describe('getWorkflowState', () => {
  it('should reject projects as stateless', () => {
    const result = getWorkflowState('project', 'any-id');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('stateless');
    }
  });

  it('should return error for non-existent feature', () => {
    const result = getWorkflowState('feature', 'non-existent-id');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('should return error for non-existent task', () => {
    const result = getWorkflowState('task', 'non-existent-id');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});
