import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'path';
import {
  resolveOrchestratorHomePathFromEnv,
} from './storage-paths';

describe('resolveOrchestratorHomePathFromEnv', () => {
  test('uses TASK_ORCHESTRATOR_HOME when set to an absolute path', () => {
    const homePath = resolveOrchestratorHomePathFromEnv({
      TASK_ORCHESTRATOR_HOME: '/tmp/custom-orchestrator',
      HOME: '/Users/demo',
    });

    expect(homePath).toBe('/tmp/custom-orchestrator');
  });

  test('expands TASK_ORCHESTRATOR_HOME when it starts with ~/', () => {
    const homePath = resolveOrchestratorHomePathFromEnv(
      {
        TASK_ORCHESTRATOR_HOME: '~/.orchestrator-test',
        HOME: '/Users/demo',
      },
      '/Users/demo'
    );

    expect(homePath).toBe('/Users/demo/.orchestrator-test');
  });

  test('resolves relative TASK_ORCHESTRATOR_HOME into an absolute path', () => {
    const homePath = resolveOrchestratorHomePathFromEnv({
      TASK_ORCHESTRATOR_HOME: '.orchestrator-test',
      HOME: '/Users/demo',
    });

    expect(homePath).toBe(resolve('.orchestrator-test'));
  });

  test('falls back to HOME/.task-orchestrator when TASK_ORCHESTRATOR_HOME is not set', () => {
    const homePath = resolveOrchestratorHomePathFromEnv(
      {
        HOME: '/Users/demo',
      },
      '/Users/demo'
    );

    expect(homePath).toBe('/Users/demo/.task-orchestrator');
  });

  test('does not preserve literal HOME=~ fallback', () => {
    const homePath = resolveOrchestratorHomePathFromEnv(
      {
        HOME: '~',
      },
      '/Users/demo'
    );

    expect(homePath).toBe(join('/Users/demo', '.task-orchestrator'));
  });
});
