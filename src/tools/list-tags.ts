import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { listTags } from '../repos/tags';

/**
 * Register the list_tags MCP tool
 * Lists all tags with their usage counts, optionally filtered by entity type
 */
export function registerListTagsTool(server: McpServer): void {
  server.tool(
    'list_tags',
    'List all tags with usage counts',
    {
      entityType: z.string().optional().describe('Filter by entity type (PROJECT, FEATURE, TASK)')
    },
    async (params) => {
      try {
        const result = listTags(
          params.entityType ? { entityType: params.entityType } : undefined
        );

        if (!result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createErrorResponse(result.error), null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createSuccessResponse('Tags listed successfully', result.data),
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
              createErrorResponse(error.message || 'Failed to list tags'),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
