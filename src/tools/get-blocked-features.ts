import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, optionalUuidSchema } from './registry';
import { getBlocked } from '../repos/dependencies';
import { DependencyEntityType } from '../domain/types';

/**
 * Register the get_blocked_features MCP tool.
 *
 * Returns all blocked features, either with status 'BLOCKED' or features
 * that have incomplete blocking dependencies.
 */
export function registerGetBlockedFeaturesTool(server: McpServer): void {
  server.tool(
    'get_blocked_features',
    'Get all blocked features. Returns features that either have status BLOCKED or have incomplete blocking dependencies (features that block them but are not completed/archived). Results are sorted by priority (descending) then creation time (ascending).',
    {
      projectId: optionalUuidSchema.describe('Filter by project ID')
    },
    async (params: any) => {
      try {
        const result = getBlocked({
          entityType: DependencyEntityType.FEATURE,
          projectId: params.projectId
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
                `Found ${result.data.length} blocked feature(s)`,
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
              createErrorResponse('Failed to get blocked features', error.message),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
