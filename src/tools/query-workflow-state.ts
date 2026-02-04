import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema } from './registry';
import { getProject } from '../repos/projects';
import { getFeature } from '../repos/features';
import { getTask } from '../repos/tasks';
import { getDependencies } from '../repos/dependencies';
import { ProjectStatus, FeatureStatus, TaskStatus } from '../domain/types';

/**
 * Status transition maps (same as get-next-status.ts)
 *
 * Note: CANCELLED and DEFERRED are intentionally non-terminal statuses.
 * They allow transitions back to earlier workflow stages (BACKLOG/PENDING for tasks,
 * PLANNING for projects) to support reinstating cancelled or deferred work.
 */
const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  [ProjectStatus.PLANNING]: [ProjectStatus.IN_DEVELOPMENT, ProjectStatus.ON_HOLD, ProjectStatus.CANCELLED],
  [ProjectStatus.IN_DEVELOPMENT]: [ProjectStatus.COMPLETED, ProjectStatus.ON_HOLD, ProjectStatus.CANCELLED],
  [ProjectStatus.ON_HOLD]: [ProjectStatus.PLANNING, ProjectStatus.IN_DEVELOPMENT, ProjectStatus.CANCELLED],
  [ProjectStatus.COMPLETED]: [ProjectStatus.ARCHIVED],
  [ProjectStatus.CANCELLED]: [ProjectStatus.PLANNING], // Non-terminal: allows reinstating cancelled projects
  [ProjectStatus.ARCHIVED]: []
};

const FEATURE_TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
  [FeatureStatus.DRAFT]: [FeatureStatus.PLANNING],
  [FeatureStatus.PLANNING]: [FeatureStatus.IN_DEVELOPMENT, FeatureStatus.ON_HOLD],
  [FeatureStatus.IN_DEVELOPMENT]: [FeatureStatus.TESTING, FeatureStatus.BLOCKED, FeatureStatus.ON_HOLD],
  [FeatureStatus.TESTING]: [FeatureStatus.VALIDATING, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.VALIDATING]: [FeatureStatus.PENDING_REVIEW, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.PENDING_REVIEW]: [FeatureStatus.DEPLOYED, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.BLOCKED]: [FeatureStatus.IN_DEVELOPMENT, FeatureStatus.ON_HOLD],
  [FeatureStatus.ON_HOLD]: [FeatureStatus.PLANNING, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.DEPLOYED]: [FeatureStatus.COMPLETED],
  [FeatureStatus.COMPLETED]: [FeatureStatus.ARCHIVED],
  [FeatureStatus.ARCHIVED]: []
};

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.BACKLOG]: [TaskStatus.PENDING],
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.ON_HOLD, TaskStatus.CANCELLED, TaskStatus.DEFERRED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.IN_REVIEW, TaskStatus.TESTING, TaskStatus.BLOCKED, TaskStatus.ON_HOLD, TaskStatus.COMPLETED],
  [TaskStatus.IN_REVIEW]: [TaskStatus.CHANGES_REQUESTED, TaskStatus.COMPLETED],
  [TaskStatus.CHANGES_REQUESTED]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.TESTING]: [TaskStatus.READY_FOR_QA, TaskStatus.IN_PROGRESS],
  [TaskStatus.READY_FOR_QA]: [TaskStatus.INVESTIGATING, TaskStatus.DEPLOYED, TaskStatus.COMPLETED],
  [TaskStatus.INVESTIGATING]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
  [TaskStatus.BLOCKED]: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
  [TaskStatus.ON_HOLD]: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
  [TaskStatus.DEPLOYED]: [TaskStatus.COMPLETED],
  [TaskStatus.COMPLETED]: [], // Terminal: no transitions allowed
  [TaskStatus.CANCELLED]: [TaskStatus.BACKLOG, TaskStatus.PENDING], // Non-terminal: allows reinstating cancelled tasks
  [TaskStatus.DEFERRED]: [TaskStatus.BACKLOG, TaskStatus.PENDING] // Non-terminal: allows resuming deferred tasks
};

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

        let currentStatus: string;
        let allowedTransitions: string[] = [];
        let dependencies: any = undefined;

        switch (containerType) {
          case 'project': {
            const result = getProject(id);
            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(createErrorResponse(result.error, result.code), null, 2)
                }]
              };
            }

            currentStatus = result.data.status;
            allowedTransitions = PROJECT_TRANSITIONS[currentStatus as ProjectStatus] || [];
            break;
          }

          case 'feature': {
            const result = getFeature(id);
            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(createErrorResponse(result.error, result.code), null, 2)
                }]
              };
            }

            currentStatus = result.data.status;
            allowedTransitions = FEATURE_TRANSITIONS[currentStatus as FeatureStatus] || [];
            break;
          }

          case 'task': {
            const taskResult = getTask(id);
            if (!taskResult.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(createErrorResponse(taskResult.error, taskResult.code), null, 2)
                }]
              };
            }

            currentStatus = taskResult.data.status;
            allowedTransitions = TASK_TRANSITIONS[currentStatus as TaskStatus] || [];

            // Get dependencies for tasks
            const depsResult = getDependencies(id, 'both');
            if (depsResult.success) {
              const blocking = depsResult.data.filter(d => d.fromTaskId === id && d.type === 'BLOCKS');
              const blockedBy = depsResult.data.filter(d => d.toTaskId === id && d.type === 'BLOCKS');

              // Check if all blockers are resolved
              const allBlockersResolved = blockedBy.length === 0 || blockedBy.every(dep => {
                const blockerResult = getTask(dep.fromTaskId);
                if (!blockerResult.success) return false;
                const blockerStatus = blockerResult.data.status;
                return blockerStatus === TaskStatus.COMPLETED || blockerStatus === TaskStatus.CANCELLED;
              });

              dependencies = {
                blocking: blocking.map(d => d.toTaskId),
                blockedBy: blockedBy.map(d => d.fromTaskId),
                allBlockersResolved
              };
            }
            break;
          }

          default:
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(
                  createErrorResponse(`Invalid container type: ${containerType}`, 'VALIDATION_ERROR'),
                  null,
                  2
                )
              }]
            };
        }

        const workflowState = {
          id,
          containerType,
          currentStatus,
          allowedTransitions,
          isTerminal: allowedTransitions.length === 0,
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
