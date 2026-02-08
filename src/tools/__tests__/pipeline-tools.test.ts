/**
 * Integration tests for v3 pipeline tools: advance, revert, terminate, block, unblock.
 *
 * These tests exercise the tool handlers by creating entities via repos,
 * then calling the tool execute functions through the MCP server mock.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { initConfig, resetConfig } from '../../config';
import { createProject } from '../../repos/projects';
import { createFeature, getFeature } from '../../repos/features';
import { createTask, getTask } from '../../repos/tasks';
import { execute, queryOne } from '../../repos/base';
import { Priority } from '../../domain/types';
import { registerAdvanceTool } from '../advance';
import { registerRevertTool } from '../revert';
import { registerTerminateTool } from '../terminate';
import { registerBlockTool } from '../block';
import { registerUnblockTool } from '../unblock';

// We capture the tool handlers during registration to call them directly.
let advanceHandler: (params: any) => Promise<any>;
let revertHandler: (params: any) => Promise<any>;
let terminateHandler: (params: any) => Promise<any>;
let blockHandler: (params: any) => Promise<any>;
let unblockHandler: (params: any) => Promise<any>;

// Mock MCP server that captures tool handlers
function createMockServer(): McpServer {
  const handlers: Record<string, any> = {};
  return {
    tool: (name: string, _desc: string, _params: any, handler: any) => {
      handlers[name] = handler;
    },
    _handlers: handlers,
  } as any;
}

function parseResponse(result: any): any {
  const text = result.content[0].text;
  return JSON.parse(text);
}

// Helper to create a feature with tasks
function createTestFeature(projectId?: string) {
  const feature = createFeature({
    projectId,
    name: 'Test Feature',
    summary: 'A test feature',
    priority: Priority.HIGH,
  });
  if (!feature.success) throw new Error(feature.error);
  return feature.data;
}

function createTestTask(featureId?: string, title?: string) {
  const task = createTask({
    featureId,
    title: title ?? 'Test Task',
    summary: 'A test task',
    priority: Priority.HIGH,
    complexity: 3,
  });
  if (!task.success) throw new Error(task.error);
  return task.data;
}

beforeAll(() => {
  resetConfig();
  initConfig({
    version: '3.0',
    pipelines: {
      feature: ['NEW', 'ACTIVE', 'CLOSED'],
      task: ['NEW', 'ACTIVE', 'CLOSED'],
    },
  });

  const server = createMockServer();
  registerAdvanceTool(server);
  registerRevertTool(server);
  registerTerminateTool(server);
  registerBlockTool(server);
  registerUnblockTool(server);

  const handlers = (server as any)._handlers;
  advanceHandler = handlers['advance'];
  revertHandler = handlers['revert'];
  terminateHandler = handlers['terminate'];
  blockHandler = handlers['block'];
  unblockHandler = handlers['unblock'];
});

beforeEach(() => {
  // Clean up all data between tests
  execute('DELETE FROM entity_tags', []);
  execute('DELETE FROM sections', []);
  execute('DELETE FROM tasks', []);
  execute('DELETE FROM features', []);
  execute('DELETE FROM projects', []);
});

// ============================================================================
// ADVANCE TESTS
// ============================================================================

describe('advance tool', () => {
  it('should advance a task from NEW to ACTIVE', async () => {
    const task = createTestTask();
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task.id, version: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.data.transition.from).toBe('NEW');
    expect(result.data.transition.to).toBe('ACTIVE');
    expect(result.data.task.status).toBe('ACTIVE');
    expect(result.data.task.version).toBe(2);
  });

  it('should advance a task from ACTIVE to CLOSED', async () => {
    const task = createTestTask();
    // First advance NEW -> ACTIVE
    await advanceHandler({ containerType: 'task', id: task.id, version: 1 });
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task.id, version: 2,
    }));

    expect(result.success).toBe(true);
    expect(result.data.transition.from).toBe('ACTIVE');
    expect(result.data.transition.to).toBe('CLOSED');
  });

  it('should advance a feature from NEW to ACTIVE', async () => {
    const feature = createTestFeature();
    const result = parseResponse(await advanceHandler({
      containerType: 'feature', id: feature.id, version: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.data.transition.from).toBe('NEW');
    expect(result.data.transition.to).toBe('ACTIVE');
  });

  it('should refuse to advance a terminal task', async () => {
    const task = createTestTask();
    await advanceHandler({ containerType: 'task', id: task.id, version: 1 });
    await advanceHandler({ containerType: 'task', id: task.id, version: 2 });
    // Now CLOSED, try to advance again
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task.id, version: 3,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('terminal state');
  });

  it('should refuse to advance a blocked task', async () => {
    const task1 = createTestTask(undefined, 'Blocker Task');
    const task2 = createTestTask(undefined, 'Blocked Task');

    // Block task2 by task1
    await blockHandler({
      containerType: 'task', id: task2.id, version: 1,
      blockedBy: [task1.id],
    });

    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task2.id, version: 2,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('blocked');
  });

  it('should refuse on version conflict', async () => {
    const task = createTestTask();
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task.id, version: 99,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('Version conflict');
  });

  it('should refuse for non-existent entity', async () => {
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: 'aaaa1111bbbb2222cccc3333dddd4444', version: 1,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('should auto-unblock dependents when task reaches CLOSED', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const blocked = createTestTask(undefined, 'Blocked');

    // Block the second task
    await blockHandler({
      containerType: 'task', id: blocked.id, version: 1,
      blockedBy: [blocker.id],
    });

    // Advance blocker to CLOSED
    await advanceHandler({ containerType: 'task', id: blocker.id, version: 1 }); // NEW -> ACTIVE
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: blocker.id, version: 2,
    })); // ACTIVE -> CLOSED

    expect(result.success).toBe(true);
    expect(result.data.unblockedEntities).toBeDefined();
    expect(result.data.unblockedEntities.length).toBe(1);
    expect(result.data.unblockedEntities[0].id).toBe(blocked.id);

    // Verify blocked task is now unblocked
    const blockedRefresh = getTask(blocked.id);
    expect(blockedRefresh.success).toBe(true);
    if (blockedRefresh.success) {
      expect(blockedRefresh.data.blockedBy).toEqual([]);
    }
  });

  it('should auto-activate parent feature when task goes NEW -> ACTIVE', async () => {
    const feature = createTestFeature();
    const task = createTestTask(feature.id);

    expect(feature.status).toBe('NEW');

    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task.id, version: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.data.featureTransition).toContain('auto-advanced to ACTIVE');

    const featureRefresh = getFeature(feature.id);
    expect(featureRefresh.success).toBe(true);
    if (featureRefresh.success) {
      expect(featureRefresh.data.status).toBe('ACTIVE');
    }
  });

  it('should auto-close feature when all tasks are CLOSED', async () => {
    const feature = createTestFeature();
    const task1 = createTestTask(feature.id, 'Task 1');
    const task2 = createTestTask(feature.id, 'Task 2');

    // Advance both tasks to CLOSED
    await advanceHandler({ containerType: 'task', id: task1.id, version: 1 }); // NEW -> ACTIVE
    await advanceHandler({ containerType: 'task', id: task1.id, version: 2 }); // ACTIVE -> CLOSED

    await advanceHandler({ containerType: 'task', id: task2.id, version: 1 }); // NEW -> ACTIVE
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task2.id, version: 2,
    })); // ACTIVE -> CLOSED

    expect(result.success).toBe(true);
    expect(result.data.featureTransition).toContain('auto-closed');

    const featureRefresh = getFeature(feature.id);
    expect(featureRefresh.success).toBe(true);
    if (featureRefresh.success) {
      expect(featureRefresh.data.status).toBe('CLOSED');
    }
  });

  it('should auto-close feature when mixed terminal (at least one CLOSED)', async () => {
    const feature = createTestFeature();
    const task1 = createTestTask(feature.id, 'Task 1');
    const task2 = createTestTask(feature.id, 'Task 2');

    // Terminate task1
    await terminateHandler({ containerType: 'task', id: task1.id, version: 1 });

    // Close task2
    await advanceHandler({ containerType: 'task', id: task2.id, version: 1 }); // NEW -> ACTIVE
    const result = parseResponse(await advanceHandler({
      containerType: 'task', id: task2.id, version: 2,
    })); // ACTIVE -> CLOSED

    expect(result.success).toBe(true);
    expect(result.data.featureTransition).toContain('auto-closed');

    const featureRefresh = getFeature(feature.id);
    expect(featureRefresh.success).toBe(true);
    if (featureRefresh.success) {
      expect(featureRefresh.data.status).toBe('CLOSED');
    }
  });
});

// ============================================================================
// REVERT TESTS
// ============================================================================

describe('revert tool', () => {
  it('should revert a task from ACTIVE to NEW', async () => {
    const task = createTestTask();
    await advanceHandler({ containerType: 'task', id: task.id, version: 1 }); // NEW -> ACTIVE

    const result = parseResponse(await revertHandler({
      containerType: 'task', id: task.id, version: 2,
    }));

    expect(result.success).toBe(true);
    expect(result.data.transition.from).toBe('ACTIVE');
    expect(result.data.transition.to).toBe('NEW');
  });

  it('should refuse to revert from first pipeline state', async () => {
    const task = createTestTask();
    const result = parseResponse(await revertHandler({
      containerType: 'task', id: task.id, version: 1,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('first pipeline state');
  });

  it('should refuse to revert from terminal state CLOSED', async () => {
    const task = createTestTask();
    await advanceHandler({ containerType: 'task', id: task.id, version: 1 });
    await advanceHandler({ containerType: 'task', id: task.id, version: 2 });

    const result = parseResponse(await revertHandler({
      containerType: 'task', id: task.id, version: 3,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('terminal state');
  });

  it('should refuse to revert from WILL_NOT_IMPLEMENT', async () => {
    const task = createTestTask();
    await terminateHandler({ containerType: 'task', id: task.id, version: 1 });

    const result = parseResponse(await revertHandler({
      containerType: 'task', id: task.id, version: 2,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('terminal state');
  });

  it('should refuse on version conflict', async () => {
    const task = createTestTask();
    await advanceHandler({ containerType: 'task', id: task.id, version: 1 });

    const result = parseResponse(await revertHandler({
      containerType: 'task', id: task.id, version: 99,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('Version conflict');
  });
});

// ============================================================================
// TERMINATE TESTS
// ============================================================================

describe('terminate tool', () => {
  it('should terminate a task to WILL_NOT_IMPLEMENT', async () => {
    const task = createTestTask();
    const result = parseResponse(await terminateHandler({
      containerType: 'task', id: task.id, version: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.data.transition.to).toBe('WILL_NOT_IMPLEMENT');
    expect(result.data.task.status).toBe('WILL_NOT_IMPLEMENT');
  });

  it('should terminate even when blocked (bypass blocked check)', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const blocked = createTestTask(undefined, 'Blocked');

    await blockHandler({
      containerType: 'task', id: blocked.id, version: 1,
      blockedBy: [blocker.id],
    });

    const result = parseResponse(await terminateHandler({
      containerType: 'task', id: blocked.id, version: 2,
    }));

    expect(result.success).toBe(true);
    expect(result.data.transition.to).toBe('WILL_NOT_IMPLEMENT');
  });

  it('should return affected dependents but NOT unblock them', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const blocked = createTestTask(undefined, 'Blocked');

    await blockHandler({
      containerType: 'task', id: blocked.id, version: 1,
      blockedBy: [blocker.id],
    });

    const result = parseResponse(await terminateHandler({
      containerType: 'task', id: blocker.id, version: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.data.affectedDependents).toBeDefined();
    expect(result.data.affectedDependents.length).toBe(1);
    expect(result.data.affectedDependents[0].id).toBe(blocked.id);

    // Verify blocked task is STILL blocked
    const blockedRefresh = getTask(blocked.id);
    expect(blockedRefresh.success).toBe(true);
    if (blockedRefresh.success) {
      expect(blockedRefresh.data.blockedBy).toContain(blocker.id);
    }
  });

  it('should refuse to terminate already terminal entity', async () => {
    const task = createTestTask();
    await terminateHandler({ containerType: 'task', id: task.id, version: 1 });

    const result = parseResponse(await terminateHandler({
      containerType: 'task', id: task.id, version: 2,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('terminal state');
  });

  it('should auto-WNI feature when all tasks are WILL_NOT_IMPLEMENT', async () => {
    const feature = createTestFeature();
    const task1 = createTestTask(feature.id, 'Task 1');
    const task2 = createTestTask(feature.id, 'Task 2');

    await terminateHandler({ containerType: 'task', id: task1.id, version: 1 });
    const result = parseResponse(await terminateHandler({
      containerType: 'task', id: task2.id, version: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.data.featureTransition).toContain('WILL_NOT_IMPLEMENT');

    const featureRefresh = getFeature(feature.id);
    expect(featureRefresh.success).toBe(true);
    if (featureRefresh.success) {
      expect(featureRefresh.data.status).toBe('WILL_NOT_IMPLEMENT');
    }
  });

  it('should auto-close feature when mixed terminal with at least one CLOSED', async () => {
    const feature = createTestFeature();
    const task1 = createTestTask(feature.id, 'Task 1');
    const task2 = createTestTask(feature.id, 'Task 2');

    // Close task1
    await advanceHandler({ containerType: 'task', id: task1.id, version: 1 }); // NEW -> ACTIVE
    await advanceHandler({ containerType: 'task', id: task1.id, version: 2 }); // ACTIVE -> CLOSED

    // Terminate task2
    const result = parseResponse(await terminateHandler({
      containerType: 'task', id: task2.id, version: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.data.featureTransition).toContain('auto-closed');

    const featureRefresh = getFeature(feature.id);
    expect(featureRefresh.success).toBe(true);
    if (featureRefresh.success) {
      expect(featureRefresh.data.status).toBe('CLOSED');
    }
  });
});

// ============================================================================
// BLOCK TESTS
// ============================================================================

describe('block tool', () => {
  it('should block a task with a UUID blocker', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const target = createTestTask(undefined, 'Target');

    const result = parseResponse(await blockHandler({
      containerType: 'task', id: target.id, version: 1,
      blockedBy: [blocker.id],
    }));

    expect(result.success).toBe(true);
    expect(result.data.addedBlockers).toContain(blocker.id);
    expect(result.data.totalBlockers).toContain(blocker.id);
  });

  it('should block a task with NO_OP and reason', async () => {
    const task = createTestTask();
    const result = parseResponse(await blockHandler({
      containerType: 'task', id: task.id, version: 1,
      blockedBy: 'NO_OP',
      blockedReason: 'Waiting for external approval',
    }));

    expect(result.success).toBe(true);
    expect(result.data.totalBlockers).toContain('NO_OP');
  });

  it('should reject NO_OP without reason', async () => {
    const task = createTestTask();
    const result = parseResponse(await blockHandler({
      containerType: 'task', id: task.id, version: 1,
      blockedBy: 'NO_OP',
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('blockedReason is required');
  });

  it('should reject non-existent blocker UUID', async () => {
    const task = createTestTask();
    const result = parseResponse(await blockHandler({
      containerType: 'task', id: task.id, version: 1,
      blockedBy: ['aaaa1111bbbb2222cccc3333dddd4444'],
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('should reject terminal blocker entity', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const target = createTestTask(undefined, 'Target');

    // Terminate the blocker
    await terminateHandler({ containerType: 'task', id: blocker.id, version: 1 });

    const result = parseResponse(await blockHandler({
      containerType: 'task', id: target.id, version: 1,
      blockedBy: [blocker.id],
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('terminal state');
  });

  it('should reject blocking a terminal entity', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const target = createTestTask(undefined, 'Target');

    await terminateHandler({ containerType: 'task', id: target.id, version: 1 });

    const result = parseResponse(await blockHandler({
      containerType: 'task', id: target.id, version: 2,
      blockedBy: [blocker.id],
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('terminal state');
  });

  it('should be idempotent (adding same blocker twice)', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const target = createTestTask(undefined, 'Target');

    await blockHandler({
      containerType: 'task', id: target.id, version: 1,
      blockedBy: [blocker.id],
    });

    const result = parseResponse(await blockHandler({
      containerType: 'task', id: target.id, version: 2,
      blockedBy: [blocker.id],
    }));

    expect(result.success).toBe(true);
    expect(result.data.addedBlockers).toEqual([]);
    expect(result.data.totalBlockers.length).toBe(1);
  });

  it('should support cross-entity blocking (feature blocks task)', async () => {
    const feature = createTestFeature();
    const task = createTestTask();

    const result = parseResponse(await blockHandler({
      containerType: 'task', id: task.id, version: 1,
      blockedBy: [feature.id],
    }));

    expect(result.success).toBe(true);
    expect(result.data.totalBlockers).toContain(feature.id);
  });
});

// ============================================================================
// UNBLOCK TESTS
// ============================================================================

describe('unblock tool', () => {
  it('should remove a specific UUID blocker', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const target = createTestTask(undefined, 'Target');

    await blockHandler({
      containerType: 'task', id: target.id, version: 1,
      blockedBy: [blocker.id],
    });

    const result = parseResponse(await unblockHandler({
      containerType: 'task', id: target.id, version: 2,
      blockedBy: [blocker.id],
    }));

    expect(result.success).toBe(true);
    expect(result.data.isFullyUnblocked).toBe(true);
    expect(result.data.removedBlockers).toContain(blocker.id);
  });

  it('should remove NO_OP blocker and clear reason', async () => {
    const task = createTestTask();

    await blockHandler({
      containerType: 'task', id: task.id, version: 1,
      blockedBy: 'NO_OP',
      blockedReason: 'Waiting',
    });

    const result = parseResponse(await unblockHandler({
      containerType: 'task', id: task.id, version: 2,
      blockedBy: 'NO_OP',
    }));

    expect(result.success).toBe(true);
    expect(result.data.isFullyUnblocked).toBe(true);

    const taskRefresh = getTask(task.id);
    expect(taskRefresh.success).toBe(true);
    if (taskRefresh.success) {
      expect(taskRefresh.data.blockedBy).toEqual([]);
      expect(taskRefresh.data.blockedReason).toBeUndefined();
    }
  });

  it('should be idempotent (removing absent blocker)', async () => {
    const task = createTestTask();
    const result = parseResponse(await unblockHandler({
      containerType: 'task', id: task.id, version: 1,
      blockedBy: ['aaaa1111bbbb2222cccc3333dddd4444'],
    }));

    expect(result.success).toBe(true);
    expect(result.data.removedBlockers).toEqual([]);
  });

  it('should partially unblock (remove one of two blockers)', async () => {
    const blocker1 = createTestTask(undefined, 'Blocker 1');
    const blocker2 = createTestTask(undefined, 'Blocker 2');
    const target = createTestTask(undefined, 'Target');

    await blockHandler({
      containerType: 'task', id: target.id, version: 1,
      blockedBy: [blocker1.id, blocker2.id],
    });

    const result = parseResponse(await unblockHandler({
      containerType: 'task', id: target.id, version: 2,
      blockedBy: [blocker1.id],
    }));

    expect(result.success).toBe(true);
    expect(result.data.isFullyUnblocked).toBe(false);
    expect(result.data.remainingBlockers).toContain(blocker2.id);
    expect(result.data.remainingBlockers).not.toContain(blocker1.id);
  });

  it('should keep blockedReason when NO_OP remains after partial unblock', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const target = createTestTask(undefined, 'Target');

    // Block with NO_OP first
    await blockHandler({
      containerType: 'task', id: target.id, version: 1,
      blockedBy: 'NO_OP',
      blockedReason: 'External dependency',
    });

    // Add UUID blocker
    await blockHandler({
      containerType: 'task', id: target.id, version: 2,
      blockedBy: [blocker.id],
    });

    // Remove only UUID blocker
    const result = parseResponse(await unblockHandler({
      containerType: 'task', id: target.id, version: 3,
      blockedBy: [blocker.id],
    }));

    expect(result.success).toBe(true);
    expect(result.data.remainingBlockers).toContain('NO_OP');

    // Reason should be preserved since NO_OP still present
    const taskRefresh = getTask(target.id);
    expect(taskRefresh.success).toBe(true);
    if (taskRefresh.success) {
      expect(taskRefresh.data.blockedReason).toBe('External dependency');
    }
  });
});

// ============================================================================
// LIFECYCLE INTEGRATION TESTS
// ============================================================================

describe('lifecycle integration', () => {
  it('full task lifecycle: NEW -> ACTIVE -> CLOSED', async () => {
    const task = createTestTask();

    const r1 = parseResponse(await advanceHandler({ containerType: 'task', id: task.id, version: 1 }));
    expect(r1.success).toBe(true);
    expect(r1.data.transition.to).toBe('ACTIVE');

    const r2 = parseResponse(await advanceHandler({ containerType: 'task', id: task.id, version: 2 }));
    expect(r2.success).toBe(true);
    expect(r2.data.transition.to).toBe('CLOSED');
  });

  it('block then advance fails, unblock then advance succeeds', async () => {
    const blocker = createTestTask(undefined, 'Blocker');
    const target = createTestTask(undefined, 'Target');

    // Block
    await blockHandler({
      containerType: 'task', id: target.id, version: 1,
      blockedBy: [blocker.id],
    });

    // Advance fails
    const fail = parseResponse(await advanceHandler({
      containerType: 'task', id: target.id, version: 2,
    }));
    expect(fail.success).toBe(false);

    // Unblock
    await unblockHandler({
      containerType: 'task', id: target.id, version: 2,
      blockedBy: [blocker.id],
    });

    // Advance succeeds
    const pass = parseResponse(await advanceHandler({
      containerType: 'task', id: target.id, version: 3,
    }));
    expect(pass.success).toBe(true);
    expect(pass.data.transition.to).toBe('ACTIVE');
  });

  it('advance-revert cycle', async () => {
    const task = createTestTask();

    await advanceHandler({ containerType: 'task', id: task.id, version: 1 });
    const r = parseResponse(await revertHandler({ containerType: 'task', id: task.id, version: 2 }));
    expect(r.success).toBe(true);
    expect(r.data.transition.to).toBe('NEW');

    const taskRefresh = getTask(task.id);
    expect(taskRefresh.success).toBe(true);
    if (taskRefresh.success) {
      expect(taskRefresh.data.status).toBe('NEW');
      expect(taskRefresh.data.version).toBe(3);
    }
  });

  it('completion auto-unblock: A blocks B, advance A to CLOSED, B becomes unblocked', async () => {
    const a = createTestTask(undefined, 'Task A');
    const b = createTestTask(undefined, 'Task B');

    // B blocked by A
    await blockHandler({
      containerType: 'task', id: b.id, version: 1,
      blockedBy: [a.id],
    });

    // Advance A to CLOSED
    await advanceHandler({ containerType: 'task', id: a.id, version: 1 }); // NEW -> ACTIVE
    const r = parseResponse(await advanceHandler({ containerType: 'task', id: a.id, version: 2 })); // ACTIVE -> CLOSED

    expect(r.success).toBe(true);
    expect(r.data.unblockedEntities).toBeDefined();
    expect(r.data.unblockedEntities.some((e: any) => e.id === b.id)).toBe(true);

    // B should be unblocked
    const bRefresh = getTask(b.id);
    expect(bRefresh.success).toBe(true);
    if (bRefresh.success) {
      expect(bRefresh.data.blockedBy).toEqual([]);
    }
  });

  it('terminate does NOT auto-unblock, returns affectedDependents', async () => {
    const a = createTestTask(undefined, 'Task A');
    const b = createTestTask(undefined, 'Task B');

    await blockHandler({
      containerType: 'task', id: b.id, version: 1,
      blockedBy: [a.id],
    });

    const r = parseResponse(await terminateHandler({
      containerType: 'task', id: a.id, version: 1,
    }));

    expect(r.success).toBe(true);
    expect(r.data.affectedDependents.some((e: any) => e.id === b.id)).toBe(true);

    // B should still be blocked
    const bRefresh = getTask(b.id);
    expect(bRefresh.success).toBe(true);
    if (bRefresh.success) {
      expect(bRefresh.data.blockedBy).toContain(a.id);
    }
  });
});
