import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { getTagUsage } from '../repos/tags';

/**
 * Register the get_tag_usage MCP tool
 * Gets all entities that use a specific tag
 */
export function registerGetTagUsageTool(server: McpServer): void {
  server.tool(
    'get_tag_usage',
    'Get all entities using a specific tag',
    {
      tag: z.string().describe('Tag to search for')
    },
    async (params) => {
      try {
        const result = getTagUsage(params.tag);

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
              createSuccessResponse('Tag usage retrieved successfully', result.data),
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
              createErrorResponse(error.message || 'Failed to get tag usage'),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
