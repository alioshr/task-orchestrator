import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema } from './registry';
import { getFeature } from '../repos/features';
import { getTask } from '../repos/tasks';
import { getDependencies } from '../repos/dependencies';
import { FeatureStatus, TaskStatus, DependencyEntityType } from '../domain/types';
import { getWorkflowState } from '../services/workflow';

/**
 * Register the query_workflow_state MCP tool.
 *
 * Returns the full workflow state for a container including current status,
 * allowed transitions, and dependency information for tasks.
 *
 * Note: CANCELLED and DEFERRED statuses can transition back to earlier stages
 * (BACKLOG/PENDING for tasks, PLANNING for projects) to support work reinstatement.
 */
export function registerQueryWorkflowStateTool(server: McpServer): void {
  server.tool(
    'query_workflow_state',
    'Query the full workflow state for a container. Returns current status, allowed transitions, whether the status is terminal, and for tasks also includes dependency information (blocking/blocked-by tasks and whether all blockers are resolved).',
    {
      containerType: z.enum(['project', 'feature', 'task']).describe('Type of container (project, feature, or task)'),
      id: uuidSchema.describe('ID of the container')
    },
    async (params: any) => {
      try {
        const { containerType, id } = params;

        // Delegate entity lookup, transitions, and terminal check to the service
        const stateResult = getWorkflowState(containerType, id);
        if (!stateResult.success) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createErrorResponse(stateResult.error, stateResult.code), null, 2)
            }]
          };
        }

        const { currentStatus, allowedTransitions, isTerminal } = stateResult.data;

        // Build dependency block for tasks and features (tool returns ID arrays + allBlockersResolved,
        // which is a different shape than the service's blockingDependencies)
        let dependencies: any = undefined;

        if (containerType === 'feature') {
          const featureDepsResult = getDependencies(id, 'both', DependencyEntityType.FEATURE);
          if (featureDepsResult.success) {
            const blocking = featureDepsResult.data.filter(d => d.fromEntityId === id && d.type === 'BLOCKS');
            const blockedBy = featureDepsResult.data.filter(d => d.toEntityId === id && d.type === 'BLOCKS');

            const allBlockersResolved = blockedBy.length === 0 || blockedBy.every(dep => {
              const blockerResult = getFeature(dep.fromEntityId);
              if (!blockerResult.success) return false;
              const blockerStatus = blockerResult.data.status;
              return blockerStatus === FeatureStatus.COMPLETED || blockerStatus === FeatureStatus.ARCHIVED;
            });

            dependencies = {
              blocking: blocking.map(d => d.toEntityId),
              blockedBy: blockedBy.map(d => d.fromEntityId),
              allBlockersResolved
            };
          }
        }

        if (containerType === 'task') {
          const depsResult = getDependencies(id, 'both', DependencyEntityType.TASK);
          if (depsResult.success) {
            const blocking = depsResult.data.filter(d => d.fromEntityId === id && d.type === 'BLOCKS');
            const blockedBy = depsResult.data.filter(d => d.toEntityId === id && d.type === 'BLOCKS');

            const allBlockersResolved = blockedBy.length === 0 || blockedBy.every(dep => {
              const blockerResult = getTask(dep.fromEntityId);
              if (!blockerResult.success) return false;
              const blockerStatus = blockerResult.data.status;
              return blockerStatus === TaskStatus.COMPLETED || blockerStatus === TaskStatus.CANCELLED;
            });

            dependencies = {
              blocking: blocking.map(d => d.toEntityId),
              blockedBy: blockedBy.map(d => d.fromEntityId),
              allBlockersResolved
            };
          }
        }

        const workflowState = {
          id,
          containerType,
          currentStatus,
          allowedTransitions,
          isTerminal,
          ...(dependencies && { dependencies })
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createSuccessResponse('Workflow state retrieved successfully', workflowState),
              null,
              2
            )
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createErrorResponse('Failed to query workflow state', error.message),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
