import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { ProjectStatus, FeatureStatus, TaskStatus } from '../domain/types';

/**
 * Status transition maps for each container type
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
 * Register the get_next_status MCP tool.
 *
 * Returns valid next statuses for a container based on its current status.
 * Note: CANCELLED and DEFERRED statuses can transition back to earlier stages
 * (BACKLOG/PENDING for tasks, PLANNING for projects) to support work reinstatement.
 */
export function registerGetNextStatusTool(server: McpServer): void {
  server.tool(
    'get_next_status',
    'Get valid next statuses for a container. Returns an array of allowed status transitions based on the container type and current status.',
    {
      containerType: z.enum(['project', 'feature', 'task']).describe('Type of container (project, feature, or task)'),
      currentStatus: z.string().describe('Current status of the container')
    },
    async (params: any) => {
      try {
        const { containerType, currentStatus } = params;
        const upperStatus = currentStatus.toUpperCase();

        let allowedTransitions: string[] = [];

        switch (containerType) {
          case 'project':
            if (upperStatus in PROJECT_TRANSITIONS) {
              allowedTransitions = PROJECT_TRANSITIONS[upperStatus as ProjectStatus];
            } else {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(
                      `Invalid project status: ${currentStatus}`,
                      'VALIDATION_ERROR'
                    ),
                    null,
                    2
                  )
                }]
              };
            }
            break;

          case 'feature':
            if (upperStatus in FEATURE_TRANSITIONS) {
              allowedTransitions = FEATURE_TRANSITIONS[upperStatus as FeatureStatus];
            } else {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(
                      `Invalid feature status: ${currentStatus}`,
                      'VALIDATION_ERROR'
                    ),
                    null,
                    2
                  )
                }]
              };
            }
            break;

          case 'task':
            if (upperStatus in TASK_TRANSITIONS) {
              allowedTransitions = TASK_TRANSITIONS[upperStatus as TaskStatus];
            } else {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(
                      `Invalid task status: ${currentStatus}`,
                      'VALIDATION_ERROR'
                    ),
                    null,
                    2
                  )
                }]
              };
            }
            break;

          default:
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(
                  createErrorResponse(
                    `Invalid container type: ${containerType}`,
                    'VALIDATION_ERROR'
                  ),
                  null,
                  2
                )
              }]
            };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createSuccessResponse(
                `Found ${allowedTransitions.length} allowed transition(s) from ${upperStatus}`,
                {
                  currentStatus: upperStatus,
                  allowedTransitions,
                  isTerminal: allowedTransitions.length === 0
                }
              ),
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
              createErrorResponse('Failed to get next status', error.message),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
