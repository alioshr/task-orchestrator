import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { renameTag } from '../repos/tags';

/**
 * Register the rename_tag MCP tool
 * Renames a tag across all entities, with optional dry-run mode
 */
export function registerRenameTagTool(server: McpServer): void {
  server.tool(
    'rename_tag',
    'Rename a tag across all entities',
    {
      oldTag: z.string().describe('Current tag name'),
      newTag: z.string().describe('New tag name'),
      dryRun: z.boolean().optional().default(false).describe('Preview changes without applying them')
    },
    async (params) => {
      try {
        const result = renameTag(
          params.oldTag,
          params.newTag,
          { dryRun: params.dryRun ?? false }
        );

        if (!result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createErrorResponse(result.error), null, 2)
            }]
          };
        }

        const message = params.dryRun
          ? `Dry run: Would affect ${result.data.affected} entities`
          : `Tag renamed successfully, affected ${result.data.affected} entities`;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createSuccessResponse(message, result.data),
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
              createErrorResponse(error.message || 'Failed to rename tag'),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
