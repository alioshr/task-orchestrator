import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, dependencyContainerTypeSchema } from './registry';
import { getNextState, isTerminal, getPipelinePosition, getPipeline, EXIT_STATE } from '../config';
import { queryOne, queryAll, execute, now } from '../repos/base';
import { transaction } from '../db/client';
import { parseJsonArray, getTable, autoUnblock } from './pipeline-helpers';

interface EntityRow {
  id: string;
  status: string;
  blocked_by: string;
  blocked_reason: string | null;
  related_to: string;
  version: number;
  feature_id?: string | null;
}

/**
 * Check feature side-effects after a task status change.
 * Returns messages about any feature transitions that occurred.
 */
function checkFeatureSideEffects(
  taskId: string,
  featureId: string,
  oldTaskStatus: string,
  newTaskStatus: string
): { featureTransition?: string; featureUnblocked?: Array<{ id: string; type: 'task' | 'feature' }> } {
  const feature = queryOne<EntityRow>(
    'SELECT id, status, blocked_by, blocked_reason, related_to, version FROM features WHERE id = ?',
    [featureId]
  );
  if (!feature) return {};

  const timestamp = now();

  // Rule: if task goes NEW -> ACTIVE and feature is NEW, auto-advance feature to ACTIVE.
  if (oldTaskStatus === 'NEW' && newTaskStatus === 'ACTIVE' && feature.status === 'NEW') {
    const nextFeatureState = getNextState('feature', 'NEW');
    if (nextFeatureState === 'ACTIVE') {
      execute(
        'UPDATE features SET status = ?, version = version + 1, modified_at = ? WHERE id = ?',
        ['ACTIVE', timestamp, featureId]
      );
      return { featureTransition: `Feature auto-advanced to ACTIVE because task started.` };
    }
  }

  // Check all-terminal rules: if ALL sibling tasks are terminal
  const siblingTasks = queryAll<{ status: string }>(
    'SELECT status FROM tasks WHERE feature_id = ?',
    [featureId]
  );

  if (siblingTasks.length === 0) return {};

  const allTerminal = siblingTasks.every(t => isTerminal('task', t.status));
  if (!allTerminal) return {};

  // Don't transition if feature is already terminal
  if (isTerminal('feature', feature.status)) return {};

  const allClosed = siblingTasks.every(t => t.status === 'CLOSED');
  const allWNI = siblingTasks.every(t => t.status === EXIT_STATE);
  const hasAtLeastOneClosed = siblingTasks.some(t => t.status === 'CLOSED');

  if (allWNI) {
    // All WILL_NOT_IMPLEMENT -> feature becomes WILL_NOT_IMPLEMENT
    execute(
      'UPDATE features SET status = ?, version = version + 1, modified_at = ? WHERE id = ?',
      [EXIT_STATE, timestamp, featureId]
    );
    return { featureTransition: `Feature set to WILL_NOT_IMPLEMENT because all tasks were terminated.` };
  }

  if (allClosed || hasAtLeastOneClosed) {
    // All CLOSED, or mixed terminal with at least one CLOSED -> feature becomes CLOSED
    const pipeline = getPipeline('feature');
    const closedState = pipeline.last;
    execute(
      'UPDATE features SET status = ?, version = version + 1, modified_at = ? WHERE id = ?',
      [closedState, timestamp, featureId]
    );

    // Feature auto-unblock on CLOSED
    const featureUnblocked = autoUnblock(featureId);
    return {
      featureTransition: `Feature auto-closed because all tasks are in terminal states.`,
      featureUnblocked: featureUnblocked.length > 0 ? featureUnblocked : undefined,
    };
  }

  return {};
}

export function registerAdvanceTool(server: McpServer): void {
  server.tool(
    'advance',
    'Advance a task or feature one step forward in its pipeline. Refuses if blocked or already terminal. Auto-unblocks dependents when reaching CLOSED. Auto-advances parent feature when task starts or all tasks complete.',
    {
      containerType: dependencyContainerTypeSchema,
      id: uuidSchema,
      version: z.number().int().describe('Current version for optimistic locking'),
    },
    async (params) => {
      try {
        const { containerType, id, version } = params;
        const table = getTable(containerType);

        const result = transaction(() => {
          // Fetch entity
          const entity = queryOne<EntityRow>(
            `SELECT id, status, blocked_by, blocked_reason, related_to, version${containerType === 'task' ? ', feature_id' : ''} FROM ${table} WHERE id = ?`,
            [id]
          );

          if (!entity) {
            return { error: `${containerType} not found: ${id}`, code: 'NOT_FOUND' };
          }

          if (entity.version !== version) {
            return { error: `Version conflict: expected ${version}, found ${entity.version}`, code: 'CONFLICT' };
          }

          // Check terminal
          if (isTerminal(containerType, entity.status)) {
            return { error: `Cannot advance: ${containerType} is in terminal state ${entity.status}`, code: 'INVALID_OPERATION' };
          }

          // Check blocked
          const blockers = parseJsonArray(entity.blocked_by);
          if (blockers.length > 0) {
            return {
              error: `Cannot advance: ${containerType} is blocked by ${blockers.join(', ')}${entity.blocked_reason ? `. Reason: ${entity.blocked_reason}` : ''}`,
              code: 'BLOCKED',
            };
          }

          // Get next state
          const nextState = getNextState(containerType, entity.status);
          if (!nextState) {
            return { error: `Cannot advance: no next state from ${entity.status}`, code: 'INVALID_OPERATION' };
          }

          const oldStatus = entity.status;
          const timestamp = now();

          // Perform the transition
          execute(
            `UPDATE ${table} SET status = ?, version = version + 1, modified_at = ? WHERE id = ?`,
            [nextState, timestamp, id]
          );

          const messages: string[] = [];
          let unblockedEntities: Array<{ id: string; type: 'task' | 'feature' }> | undefined;
          let featureTransitionMsg: string | undefined;
          let featureUnblockedEntities: Array<{ id: string; type: 'task' | 'feature' }> | undefined;

          // Auto-unblock on CLOSED
          if (isTerminal(containerType, nextState) && nextState !== EXIT_STATE) {
            unblockedEntities = autoUnblock(id);
            if (unblockedEntities.length > 0) {
              messages.push(`Auto-unblocked ${unblockedEntities.length} dependent(s).`);
            }
          }

          // Feature side-effects (task only)
          if (containerType === 'task' && entity.feature_id) {
            const sideEffects = checkFeatureSideEffects(id, entity.feature_id, oldStatus, nextState);
            if (sideEffects.featureTransition) {
              featureTransitionMsg = sideEffects.featureTransition;
              messages.push(featureTransitionMsg);
            }
            if (sideEffects.featureUnblocked) {
              featureUnblockedEntities = sideEffects.featureUnblocked;
              messages.push(`Feature auto-unblocked ${featureUnblockedEntities.length} dependent(s).`);
            }
          }

          // Re-fetch entity after updates
          const updated = queryOne<EntityRow & { feature_id?: string | null }>(
            `SELECT * FROM ${table} WHERE id = ?`,
            [id]
          );

          return {
            success: true,
            entity: updated,
            oldStatus,
            newStatus: nextState,
            pipelinePosition: getPipelinePosition(containerType, nextState),
            messages,
            unblockedEntities,
            featureTransitionMsg,
            featureUnblockedEntities,
          };
        });

        if ('error' in result) {
          const response = createErrorResponse(result.error as string, result.code as string | undefined);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const mainMessage = `${containerType} advanced: ${result.oldStatus} → ${result.newStatus} (position: ${result.pipelinePosition ?? 'terminal'})`;
        const fullMessage = [mainMessage, ...result.messages].join(' ');

        const response = createSuccessResponse(fullMessage, {
          [params.containerType]: result.entity,
          transition: { from: result.oldStatus, to: result.newStatus },
          pipelinePosition: result.pipelinePosition,
          unblockedEntities: result.unblockedEntities,
          featureTransition: result.featureTransitionMsg,
          featureUnblockedEntities: result.featureUnblockedEntities,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error: any) {
        const response = createErrorResponse(error.message || 'Internal error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      }
    }
  );
}
