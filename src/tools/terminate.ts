import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, dependencyContainerTypeSchema } from './registry';
import { isTerminal, EXIT_STATE, getPipeline } from '../config';
import { queryOne, queryAll, execute, now } from '../repos/base';
import { transaction } from '../db/client';
import { getTable, autoUnblock, findAffectedDependents } from './pipeline-helpers';

interface EntityRow {
  id: string;
  status: string;
  blocked_by: string;
  blocked_reason: string | null;
  version: number;
  feature_id?: string | null;
}

interface DependentsResult {
  id: string;
  type: 'task' | 'feature';
}

interface SideEffectsResult {
  featureTransition?: string;
  featureUnblocked?: DependentsResult[];
  featureAffectedDependents?: DependentsResult[];
}

interface TerminateErrorResult {
  error: string;
  code: string;
}

interface TerminateSuccessResult {
  success: true;
  entity: any;
  oldStatus: string;
  newStatus: string;
  reason?: string;
  affectedDependents: DependentsResult[];
  messages: string[];
  featureTransitionMsg?: string;
  featureUnblockedEntities?: DependentsResult[];
  featureAffectedDependents?: DependentsResult[];
}

type TerminateResult = TerminateSuccessResult | TerminateErrorResult;

/**
 * Check and apply feature side-effects after a task is terminated.
 */
function checkFeatureSideEffectsOnTerminate(
  featureId: string
): SideEffectsResult {
  const feature = queryOne<EntityRow>(
    'SELECT id, status, blocked_by, blocked_reason, version FROM features WHERE id = ?',
    [featureId]
  );
  if (!feature) return {};
  if (isTerminal('feature', feature.status)) return {};

  const siblingTasks = queryAll<{ status: string }>(
    'SELECT status FROM tasks WHERE feature_id = ?',
    [featureId]
  );
  if (siblingTasks.length === 0) return {};

  const allTerminal = siblingTasks.every(t => isTerminal('task', t.status));
  if (!allTerminal) return {};

  const allWNI = siblingTasks.every(t => t.status === EXIT_STATE);
  const hasAtLeastOneClosed = siblingTasks.some(t => t.status === 'CLOSED');

  const timestamp = now();

  if (allWNI) {
    execute(
      'UPDATE features SET status = ?, version = version + 1, modified_at = ? WHERE id = ?',
      [EXIT_STATE, timestamp, featureId]
    );
    const featureAffectedDependents = findAffectedDependents(featureId);
    return {
      featureTransition: 'Feature set to WILL_NOT_IMPLEMENT because all tasks were terminated.',
      featureAffectedDependents: featureAffectedDependents.length > 0 ? featureAffectedDependents : undefined,
    };
  }

  if (hasAtLeastOneClosed) {
    const pipeline = getPipeline('feature');
    execute(
      'UPDATE features SET status = ?, version = version + 1, modified_at = ? WHERE id = ?',
      [pipeline.last, timestamp, featureId]
    );
    const featureUnblocked = autoUnblock(featureId);
    return {
      featureTransition: `Feature auto-closed because all tasks are in terminal states.`,
      featureUnblocked: featureUnblocked.length > 0 ? featureUnblocked : undefined,
    };
  }

  return {};
}

export function registerTerminateTool(server: McpServer): void {
  server.tool(
    'terminate',
    'Terminate a task or feature by setting it to WILL_NOT_IMPLEMENT. Bypasses blocked checks. Does NOT auto-unblock dependents — returns affected dependents for manual reassessment. Triggers feature side-effects when all sibling tasks are terminal.',
    {
      containerType: dependencyContainerTypeSchema,
      id: uuidSchema,
      version: z.number().int().describe('Current version for optimistic locking'),
      reason: z.string().optional().describe('Optional reason for termination'),
    },
    async (params) => {
      try {
        const { containerType, id, version, reason } = params;
        const table = getTable(containerType);

        const result: TerminateResult = transaction(() => {
          const entity = queryOne<EntityRow>(
            `SELECT id, status, blocked_by, blocked_reason, version${containerType === 'task' ? ', feature_id' : ''} FROM ${table} WHERE id = ?`,
            [id]
          );

          if (!entity) {
            return { error: `${containerType} not found: ${id}`, code: 'NOT_FOUND' };
          }

          if (entity.version !== version) {
            return { error: `Version conflict: expected ${version}, found ${entity.version}`, code: 'CONFLICT' };
          }

          if (isTerminal(containerType, entity.status)) {
            return { error: `Cannot terminate: ${containerType} is already in terminal state ${entity.status}`, code: 'INVALID_OPERATION' };
          }

          const oldStatus = entity.status;
          const timestamp = now();

          // Terminate — preserve blocked_by/blocked_reason
          execute(
            `UPDATE ${table} SET status = ?, version = version + 1, modified_at = ? WHERE id = ?`,
            [EXIT_STATE, timestamp, id]
          );

          // Find affected dependents (but do NOT unblock them)
          const affectedDependents = findAffectedDependents(id);

          const messages: string[] = [];
          let featureTransitionMsg: string | undefined;
          let featureUnblockedEntities: DependentsResult[] | undefined;
          let featureAffectedDependents: DependentsResult[] | undefined;

          if (affectedDependents.length > 0) {
            messages.push(
              `WARNING: ${affectedDependents.length} entity/entities are blocked by this ${containerType}. ` +
              `They remain blocked and must be manually reassessed (unblock or terminate).`
            );
          }

          // Feature side-effects (task only)
          if (containerType === 'task' && entity.feature_id) {
            const sideEffects = checkFeatureSideEffectsOnTerminate(entity.feature_id);
            if (sideEffects.featureTransition) {
              featureTransitionMsg = sideEffects.featureTransition;
              messages.push(featureTransitionMsg);
            }
            if (sideEffects.featureUnblocked) {
              featureUnblockedEntities = sideEffects.featureUnblocked;
              messages.push(`Feature auto-unblocked ${featureUnblockedEntities.length} dependent(s).`);
            }
            if (sideEffects.featureAffectedDependents) {
              featureAffectedDependents = sideEffects.featureAffectedDependents;
              messages.push(
                `WARNING: feature now in WILL_NOT_IMPLEMENT still blocks ${featureAffectedDependents.length} dependent(s). ` +
                'Reassess each dependent (unblock, re-plan, or terminate).'
              );
            }
          }

          // Re-fetch updated entity
          const updated = queryOne<any>(
            `SELECT * FROM ${table} WHERE id = ?`,
            [id]
          );

          return {
            success: true,
            entity: updated,
            oldStatus,
            newStatus: EXIT_STATE,
            reason,
            affectedDependents,
            messages,
            featureTransitionMsg,
            featureUnblockedEntities,
            featureAffectedDependents,
          };
        });

        if ('error' in result) {
          const response = createErrorResponse(result.error, result.code);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const mainMessage = `${containerType} terminated: ${result.oldStatus} → WILL_NOT_IMPLEMENT${result.reason ? ` (reason: ${result.reason})` : ''}`;
        const fullMessage = [mainMessage, ...result.messages].join(' ');

        const response = createSuccessResponse(fullMessage, {
          [params.containerType]: result.entity,
          transition: { from: result.oldStatus, to: EXIT_STATE },
          reason: result.reason,
          affectedDependents: result.affectedDependents,
          featureTransition: result.featureTransitionMsg,
          featureUnblockedEntities: result.featureUnblockedEntities,
          featureAffectedDependents: result.featureAffectedDependents,
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
