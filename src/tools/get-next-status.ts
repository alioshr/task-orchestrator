import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { ProjectStatus, FeatureStatus, TaskStatus } from '../domain/types';
import { PROJECT_TRANSITIONS, FEATURE_TRANSITIONS, TASK_TRANSITIONS } from '../services/status-validator';

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
