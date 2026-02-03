import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { getBlockedTasks } from '../repos/dependencies';

/**
 * Register the get_blocked_tasks MCP tool.
 *
 * Returns all blocked tasks, either with status 'BLOCKED' or tasks
 * that have incomplete blocking dependencies.
 */
export function registerGetBlockedTasksTool(server: McpServer): void {
  server.tool(
    'get_blocked_tasks',
    'Get all blocked tasks. Returns tasks that either have status BLOCKED or have incomplete blocking dependencies (tasks that block them but are not completed). Results are sorted by priority (descending) then creation time (ascending).',
    {
      projectId: z.string().uuid().optional().describe('Filter by project ID'),
      featureId: z.string().uuid().optional().describe('Filter by feature ID')
    },
    async (params: any) => {
      try {
        const result = getBlockedTasks({
          projectId: params.projectId,
          featureId: params.featureId
        });

        if (!result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createErrorResponse(result.error, result.code), null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createSuccessResponse(
                `Found ${result.data.length} blocked task(s)`,
                result.data
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
              createErrorResponse('Failed to get blocked tasks', error.message),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
