import { describe, it, expect, beforeAll } from 'bun:test';
import {
  getAllowedTransitions,
  isValidTransition,
  isTerminalStatus,
  isStatusValid,
  type ContainerType
} from './status-validator';
import { initConfig, resetConfig } from '../config';

beforeAll(() => {
  resetConfig();
  initConfig({
    version: '3.0',
    pipelines: {
      feature: ['NEW', 'ACTIVE', 'READY_TO_PROD', 'CLOSED'],
      task: ['NEW', 'ACTIVE', 'TO_BE_TESTED', 'READY_TO_PROD', 'CLOSED'],
    },
  });
});

describe('isTerminalStatus', () => {
  it('should return false for projects (stateless)', () => {
    expect(isTerminalStatus('project', 'anything')).toBe(false);
  });

  it('should identify CLOSED as terminal for features', () => {
    expect(isTerminalStatus('feature', 'CLOSED')).toBe(true);
  });

  it('should identify WILL_NOT_IMPLEMENT as terminal for features', () => {
    expect(isTerminalStatus('feature', 'WILL_NOT_IMPLEMENT')).toBe(true);
  });

  it('should identify CLOSED as terminal for tasks', () => {
    expect(isTerminalStatus('task', 'CLOSED')).toBe(true);
  });

  it('should identify WILL_NOT_IMPLEMENT as terminal for tasks', () => {
    expect(isTerminalStatus('task', 'WILL_NOT_IMPLEMENT')).toBe(true);
  });

  it('should return false for non-terminal task states', () => {
    expect(isTerminalStatus('task', 'NEW')).toBe(false);
    expect(isTerminalStatus('task', 'ACTIVE')).toBe(false);
    expect(isTerminalStatus('task', 'TO_BE_TESTED')).toBe(false);
    expect(isTerminalStatus('task', 'READY_TO_PROD')).toBe(false);
  });

  it('should return false for non-terminal feature states', () => {
    expect(isTerminalStatus('feature', 'NEW')).toBe(false);
    expect(isTerminalStatus('feature', 'ACTIVE')).toBe(false);
    expect(isTerminalStatus('feature', 'READY_TO_PROD')).toBe(false);
  });

  it('should return false for unknown statuses', () => {
    expect(isTerminalStatus('task', 'UNKNOWN')).toBe(false);
  });
});

describe('getAllowedTransitions', () => {
  it('should return empty for projects (stateless)', () => {
    expect(getAllowedTransitions('project', 'anything')).toEqual([]);
  });

  it('should return advance + terminate for first feature state', () => {
    const transitions = getAllowedTransitions('feature', 'NEW');
    expect(transitions).toContain('ACTIVE');
    expect(transitions).toContain('WILL_NOT_IMPLEMENT');
    expect(transitions).not.toContain('CLOSED');
  });

  it('should return advance + revert + terminate for mid-pipeline feature state', () => {
    const transitions = getAllowedTransitions('feature', 'ACTIVE');
    expect(transitions).toContain('READY_TO_PROD'); // advance
    expect(transitions).toContain('NEW'); // revert
    expect(transitions).toContain('WILL_NOT_IMPLEMENT'); // terminate
  });

  it('should return advance + revert + terminate for first task state', () => {
    const transitions = getAllowedTransitions('task', 'NEW');
    expect(transitions).toContain('ACTIVE');
    expect(transitions).toContain('WILL_NOT_IMPLEMENT');
    expect(transitions).not.toContain('CLOSED');
  });

  it('should return revert + terminate for last non-terminal task state', () => {
    const transitions = getAllowedTransitions('task', 'READY_TO_PROD');
    expect(transitions).toContain('CLOSED'); // advance
    expect(transitions).toContain('TO_BE_TESTED'); // revert
    expect(transitions).toContain('WILL_NOT_IMPLEMENT'); // terminate
  });

  it('should return empty for terminal states', () => {
    expect(getAllowedTransitions('task', 'CLOSED')).toEqual([]);
    expect(getAllowedTransitions('task', 'WILL_NOT_IMPLEMENT')).toEqual([]);
    expect(getAllowedTransitions('feature', 'CLOSED')).toEqual([]);
    expect(getAllowedTransitions('feature', 'WILL_NOT_IMPLEMENT')).toEqual([]);
  });

  it('should return empty for unknown status', () => {
    expect(getAllowedTransitions('task', 'BOGUS')).toEqual([]);
  });
});

describe('isValidTransition', () => {
  it('should always return false for projects', () => {
    expect(isValidTransition('project', 'anything', 'else')).toBe(false);
  });

  it('should allow advance transitions for tasks', () => {
    expect(isValidTransition('task', 'NEW', 'ACTIVE')).toBe(true);
    expect(isValidTransition('task', 'ACTIVE', 'TO_BE_TESTED')).toBe(true);
    expect(isValidTransition('task', 'TO_BE_TESTED', 'READY_TO_PROD')).toBe(true);
    expect(isValidTransition('task', 'READY_TO_PROD', 'CLOSED')).toBe(true);
  });

  it('should allow revert transitions for tasks', () => {
    expect(isValidTransition('task', 'ACTIVE', 'NEW')).toBe(true);
    expect(isValidTransition('task', 'TO_BE_TESTED', 'ACTIVE')).toBe(true);
    expect(isValidTransition('task', 'READY_TO_PROD', 'TO_BE_TESTED')).toBe(true);
  });

  it('should allow terminate from any non-terminal task state', () => {
    expect(isValidTransition('task', 'NEW', 'WILL_NOT_IMPLEMENT')).toBe(true);
    expect(isValidTransition('task', 'ACTIVE', 'WILL_NOT_IMPLEMENT')).toBe(true);
    expect(isValidTransition('task', 'TO_BE_TESTED', 'WILL_NOT_IMPLEMENT')).toBe(true);
    expect(isValidTransition('task', 'READY_TO_PROD', 'WILL_NOT_IMPLEMENT')).toBe(true);
  });

  it('should reject skipping pipeline states', () => {
    expect(isValidTransition('task', 'NEW', 'TO_BE_TESTED')).toBe(false);
    expect(isValidTransition('task', 'NEW', 'CLOSED')).toBe(false);
    expect(isValidTransition('task', 'ACTIVE', 'CLOSED')).toBe(false);
  });

  it('should reject transitions from terminal states', () => {
    expect(isValidTransition('task', 'CLOSED', 'NEW')).toBe(false);
    expect(isValidTransition('task', 'WILL_NOT_IMPLEMENT', 'NEW')).toBe(false);
    expect(isValidTransition('feature', 'CLOSED', 'NEW')).toBe(false);
  });
});

describe('isStatusValid', () => {
  it('should return true for projects always', () => {
    expect(isStatusValid('project', 'anything')).toBe(true);
  });

  it('should recognize valid feature states', () => {
    expect(isStatusValid('feature', 'NEW')).toBe(true);
    expect(isStatusValid('feature', 'ACTIVE')).toBe(true);
    expect(isStatusValid('feature', 'CLOSED')).toBe(true);
    expect(isStatusValid('feature', 'WILL_NOT_IMPLEMENT')).toBe(true);
  });

  it('should reject unknown feature states', () => {
    expect(isStatusValid('feature', 'IN_DEVELOPMENT')).toBe(false);
    expect(isStatusValid('feature', 'DRAFT')).toBe(false);
  });

  it('should recognize valid task states', () => {
    expect(isStatusValid('task', 'NEW')).toBe(true);
    expect(isStatusValid('task', 'ACTIVE')).toBe(true);
    expect(isStatusValid('task', 'CLOSED')).toBe(true);
    expect(isStatusValid('task', 'WILL_NOT_IMPLEMENT')).toBe(true);
  });

  it('should reject unknown task states', () => {
    expect(isStatusValid('task', 'PENDING')).toBe(false);
    expect(isStatusValid('task', 'IN_PROGRESS')).toBe(false);
  });
});

describe('v3 workflow scenarios', () => {
  it('should support complete feature lifecycle: NEW -> ACTIVE -> READY_TO_PROD -> CLOSED', () => {
    expect(isValidTransition('feature', 'NEW', 'ACTIVE')).toBe(true);
    expect(isValidTransition('feature', 'ACTIVE', 'READY_TO_PROD')).toBe(true);
    expect(isValidTransition('feature', 'READY_TO_PROD', 'CLOSED')).toBe(true);
    expect(isTerminalStatus('feature', 'CLOSED')).toBe(true);
  });

  it('should support complete task lifecycle: NEW -> ACTIVE -> ... -> CLOSED', () => {
    expect(isValidTransition('task', 'NEW', 'ACTIVE')).toBe(true);
    expect(isValidTransition('task', 'ACTIVE', 'TO_BE_TESTED')).toBe(true);
    expect(isValidTransition('task', 'TO_BE_TESTED', 'READY_TO_PROD')).toBe(true);
    expect(isValidTransition('task', 'READY_TO_PROD', 'CLOSED')).toBe(true);
    expect(isTerminalStatus('task', 'CLOSED')).toBe(true);
  });

  it('should support terminate from any active state', () => {
    expect(isValidTransition('task', 'ACTIVE', 'WILL_NOT_IMPLEMENT')).toBe(true);
    expect(isTerminalStatus('task', 'WILL_NOT_IMPLEMENT')).toBe(true);
  });
});
