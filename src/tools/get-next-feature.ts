import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, optionalUuidSchema } from './registry';
import { getNext } from '../repos/dependencies';
import { DependencyEntityType } from '../domain/types';

/**
 * Register the get_next_feature MCP tool.
 *
 * Recommends the next feature to work on by priority,
 * excluding blocked features.
 */
export function registerGetNextFeatureTool(server: McpServer): void {
  server.tool(
    'get_next_feature',
    'Get the next recommended feature to work on. Returns the highest priority DRAFT or PLANNING feature that has no incomplete blocking dependencies. Features are prioritized by priority (HIGH > MEDIUM > LOW), then by creation time.',
    {
      projectId: optionalUuidSchema.describe('Filter by project ID'),
      priority: z.string().optional().describe('Filter by priority (HIGH, MEDIUM, LOW)')
    },
    async (params: any) => {
      try {
        const result = getNext({
          entityType: DependencyEntityType.FEATURE,
          projectId: params.projectId,
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
                createSuccessResponse('No available features found matching the criteria', null),
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
              createSuccessResponse('Next feature retrieved successfully', result.data),
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
              createErrorResponse('Failed to get next feature', error.message),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
