import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { getNextTask } from '../repos/dependencies';

/**
 * Register the get_next_task MCP tool.
 *
 * Recommends the next task to work on by priority and complexity,
 * excluding blocked tasks.
 */
export function registerGetNextTaskTool(server: McpServer): void {
  server.tool(
    'get_next_task',
    'Get the next recommended task to work on. Returns the highest priority PENDING task that has no incomplete blocking dependencies. Tasks are prioritized by priority (HIGH > MEDIUM > LOW), then by complexity (simpler first), then by creation time.',
    {
      projectId: z.string().uuid().optional().describe('Filter by project ID'),
      featureId: z.string().uuid().optional().describe('Filter by feature ID'),
      priority: z.string().optional().describe('Filter by priority (HIGH, MEDIUM, LOW)')
    },
    async (params: any) => {
      try {
        const result = getNextTask({
          projectId: params.projectId,
          featureId: params.featureId,
          priority: params.priority
        });

        if (!result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createErrorResponse(result.error, result.code), null, 2)
            }]
          };
        }

        if (result.data === null) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createSuccessResponse('No available tasks found matching the criteria', null),
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
              createSuccessResponse('Next task retrieved successfully', result.data),
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
              createErrorResponse('Failed to get next task', error.message),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
