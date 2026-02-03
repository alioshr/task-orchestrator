import { describe, it, expect } from 'bun:test';
import {
  isValidStatus,
  getValidStatuses,
  getTransitions,
  getAllowedTransitions,
  isValidTransition,
  isTerminalStatus,
  type ContainerType
} from './status-validator';
import { ProjectStatus, FeatureStatus, TaskStatus } from '../domain/types';

describe('isValidStatus', () => {
  it('should validate project statuses', () => {
    expect(isValidStatus('project', 'PLANNING')).toBe(true);
    expect(isValidStatus('project', 'IN_DEVELOPMENT')).toBe(true);
    expect(isValidStatus('project', 'INVALID')).toBe(false);
  });

  it('should validate feature statuses', () => {
    expect(isValidStatus('feature', 'DRAFT')).toBe(true);
    expect(isValidStatus('feature', 'IN_DEVELOPMENT')).toBe(true);
    expect(isValidStatus('feature', 'INVALID')).toBe(false);
  });

  it('should validate task statuses', () => {
    expect(isValidStatus('task', 'PENDING')).toBe(true);
    expect(isValidStatus('task', 'IN_PROGRESS')).toBe(true);
    expect(isValidStatus('task', 'INVALID')).toBe(false);
  });
});

describe('getValidStatuses', () => {
  it('should return all valid project statuses', () => {
    const statuses = getValidStatuses('project');
    expect(statuses).toContain('PLANNING');
    expect(statuses).toContain('IN_DEVELOPMENT');
    expect(statuses).toContain('COMPLETED');
    expect(statuses).toContain('ARCHIVED');
    expect(statuses.length).toBe(6);
  });

  it('should return all valid feature statuses', () => {
    const statuses = getValidStatuses('feature');
    expect(statuses).toContain('DRAFT');
    expect(statuses).toContain('PLANNING');
    expect(statuses).toContain('DEPLOYED');
    expect(statuses.length).toBe(11);
  });

  it('should return all valid task statuses', () => {
    const statuses = getValidStatuses('task');
    expect(statuses).toContain('BACKLOG');
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('COMPLETED');
    expect(statuses.length).toBe(14);
  });
});

describe('getTransitions', () => {
  it('should return project transition map', () => {
    const transitions = getTransitions('project');
    expect(transitions['PLANNING']).toContain('IN_DEVELOPMENT');
    expect(transitions['COMPLETED']).toContain('ARCHIVED');
  });

  it('should return feature transition map', () => {
    const transitions = getTransitions('feature');
    expect(transitions['DRAFT']).toContain('PLANNING');
    expect(transitions['DEPLOYED']).toContain('COMPLETED');
  });

  it('should return task transition map', () => {
    const transitions = getTransitions('task');
    expect(transitions['PENDING']).toContain('IN_PROGRESS');
    expect(transitions['IN_PROGRESS']).toContain('COMPLETED');
  });
});

describe('getAllowedTransitions', () => {
  it('should return allowed transitions for project status', () => {
    const transitions = getAllowedTransitions('project', 'PLANNING');
    expect(transitions).toContain('IN_DEVELOPMENT');
    expect(transitions).toContain('ON_HOLD');
    expect(transitions).toContain('CANCELLED');
  });

  it('should return allowed transitions for feature status', () => {
    const transitions = getAllowedTransitions('feature', 'IN_DEVELOPMENT');
    expect(transitions).toContain('TESTING');
    expect(transitions).toContain('BLOCKED');
    expect(transitions).toContain('ON_HOLD');
  });

  it('should return allowed transitions for task status', () => {
    const transitions = getAllowedTransitions('task', 'PENDING');
    expect(transitions).toContain('IN_PROGRESS');
    expect(transitions).toContain('BLOCKED');
    expect(transitions).toContain('ON_HOLD');
  });

  it('should return empty array for terminal statuses', () => {
    expect(getAllowedTransitions('project', 'ARCHIVED')).toEqual([]);
    expect(getAllowedTransitions('feature', 'ARCHIVED')).toEqual([]);
    expect(getAllowedTransitions('task', 'COMPLETED')).toEqual([]);
  });

  it('should return empty array for unknown status', () => {
    expect(getAllowedTransitions('task', 'UNKNOWN_STATUS')).toEqual([]);
  });
});

describe('isValidTransition', () => {
  it('should validate valid project transitions', () => {
    expect(isValidTransition('project', 'PLANNING', 'IN_DEVELOPMENT')).toBe(true);
    expect(isValidTransition('project', 'COMPLETED', 'ARCHIVED')).toBe(true);
  });

  it('should reject invalid project transitions', () => {
    expect(isValidTransition('project', 'PLANNING', 'ARCHIVED')).toBe(false);
    expect(isValidTransition('project', 'ARCHIVED', 'PLANNING')).toBe(false);
  });

  it('should validate valid feature transitions', () => {
    expect(isValidTransition('feature', 'DRAFT', 'PLANNING')).toBe(true);
    expect(isValidTransition('feature', 'IN_DEVELOPMENT', 'TESTING')).toBe(true);
  });

  it('should reject invalid feature transitions', () => {
    expect(isValidTransition('feature', 'DRAFT', 'DEPLOYED')).toBe(false);
    expect(isValidTransition('feature', 'ARCHIVED', 'PLANNING')).toBe(false);
  });

  it('should validate valid task transitions', () => {
    expect(isValidTransition('task', 'PENDING', 'IN_PROGRESS')).toBe(true);
    expect(isValidTransition('task', 'IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(isValidTransition('task', 'IN_REVIEW', 'CHANGES_REQUESTED')).toBe(true);
  });

  it('should reject invalid task transitions', () => {
    expect(isValidTransition('task', 'PENDING', 'COMPLETED')).toBe(false);
    expect(isValidTransition('task', 'COMPLETED', 'IN_PROGRESS')).toBe(false);
  });

  it('should allow transitions from cancelled/deferred back to backlog/pending', () => {
    expect(isValidTransition('task', 'CANCELLED', 'BACKLOG')).toBe(true);
    expect(isValidTransition('task', 'CANCELLED', 'PENDING')).toBe(true);
    expect(isValidTransition('task', 'DEFERRED', 'BACKLOG')).toBe(true);
    expect(isValidTransition('task', 'DEFERRED', 'PENDING')).toBe(true);
  });
});

describe('isTerminalStatus', () => {
  it('should identify terminal project statuses', () => {
    expect(isTerminalStatus('project', 'ARCHIVED')).toBe(true);
    expect(isTerminalStatus('project', 'PLANNING')).toBe(false);
    expect(isTerminalStatus('project', 'COMPLETED')).toBe(false);
  });

  it('should identify terminal feature statuses', () => {
    expect(isTerminalStatus('feature', 'ARCHIVED')).toBe(true);
    expect(isTerminalStatus('feature', 'COMPLETED')).toBe(false);
    expect(isTerminalStatus('feature', 'DEPLOYED')).toBe(false);
  });

  it('should identify terminal task statuses', () => {
    expect(isTerminalStatus('task', 'COMPLETED')).toBe(true);
    expect(isTerminalStatus('task', 'CANCELLED')).toBe(false);
    expect(isTerminalStatus('task', 'IN_PROGRESS')).toBe(false);
  });

  it('should return false for unknown statuses', () => {
    expect(isTerminalStatus('task', 'UNKNOWN')).toBe(false);
  });
});

describe('workflow scenarios', () => {
  it('should support complete project lifecycle', () => {
    expect(isValidTransition('project', 'PLANNING', 'IN_DEVELOPMENT')).toBe(true);
    expect(isValidTransition('project', 'IN_DEVELOPMENT', 'COMPLETED')).toBe(true);
    expect(isValidTransition('project', 'COMPLETED', 'ARCHIVED')).toBe(true);
    expect(isTerminalStatus('project', 'ARCHIVED')).toBe(true);
  });

  it('should support complete feature lifecycle', () => {
    expect(isValidTransition('feature', 'DRAFT', 'PLANNING')).toBe(true);
    expect(isValidTransition('feature', 'PLANNING', 'IN_DEVELOPMENT')).toBe(true);
    expect(isValidTransition('feature', 'IN_DEVELOPMENT', 'TESTING')).toBe(true);
    expect(isValidTransition('feature', 'TESTING', 'VALIDATING')).toBe(true);
    expect(isValidTransition('feature', 'VALIDATING', 'PENDING_REVIEW')).toBe(true);
    expect(isValidTransition('feature', 'PENDING_REVIEW', 'DEPLOYED')).toBe(true);
    expect(isValidTransition('feature', 'DEPLOYED', 'COMPLETED')).toBe(true);
    expect(isValidTransition('feature', 'COMPLETED', 'ARCHIVED')).toBe(true);
    expect(isTerminalStatus('feature', 'ARCHIVED')).toBe(true);
  });

  it('should support complete task lifecycle', () => {
    expect(isValidTransition('task', 'BACKLOG', 'PENDING')).toBe(true);
    expect(isValidTransition('task', 'PENDING', 'IN_PROGRESS')).toBe(true);
    expect(isValidTransition('task', 'IN_PROGRESS', 'IN_REVIEW')).toBe(true);
    expect(isValidTransition('task', 'IN_REVIEW', 'COMPLETED')).toBe(true);
    expect(isTerminalStatus('task', 'COMPLETED')).toBe(true);
  });

  it('should support on-hold workflow', () => {
    expect(isValidTransition('project', 'IN_DEVELOPMENT', 'ON_HOLD')).toBe(true);
    expect(isValidTransition('project', 'ON_HOLD', 'IN_DEVELOPMENT')).toBe(true);

    expect(isValidTransition('feature', 'IN_DEVELOPMENT', 'ON_HOLD')).toBe(true);
    expect(isValidTransition('feature', 'ON_HOLD', 'IN_DEVELOPMENT')).toBe(true);

    expect(isValidTransition('task', 'IN_PROGRESS', 'ON_HOLD')).toBe(true);
    expect(isValidTransition('task', 'ON_HOLD', 'IN_PROGRESS')).toBe(true);
  });

  it('should support blocked workflow', () => {
    expect(isValidTransition('feature', 'IN_DEVELOPMENT', 'BLOCKED')).toBe(true);
    expect(isValidTransition('feature', 'BLOCKED', 'IN_DEVELOPMENT')).toBe(true);

    expect(isValidTransition('task', 'PENDING', 'BLOCKED')).toBe(true);
    expect(isValidTransition('task', 'BLOCKED', 'IN_PROGRESS')).toBe(true);
  });
});
