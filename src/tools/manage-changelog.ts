import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema } from './registry';
import { appendChangelog, searchChangelog } from '../repos/graph-changelog';

export function registerManageChangelogTool(server: McpServer): void {
  server.tool(
    'manage_changelog',
    'Append and search changelog entries for knowledge graph atoms and molecules. Changelog entries are immutable once created.',
    {
      operation: z.enum(['append', 'search']),
      parentType: z.enum(['atom', 'molecule']),
      parentId: uuidSchema,
      taskId: z.string()
        .regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i, 'Invalid UUID')
        .optional()
        .transform(v => v ? v.replace(/-/g, '').toLowerCase() : undefined),
      summary: z.string().optional(),
      limit: z.coerce.number().int().optional().default(20),
      offset: z.coerce.number().int().optional().default(0),
    },
    async (params) => {
      try {
        const { operation, parentType, parentId } = params;

        // ===== APPEND OPERATION =====
        if (operation === 'append') {
          if (!params.taskId) {
            const response = createErrorResponse('taskId is required for append operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (!params.summary) {
            const response = createErrorResponse('summary is required for append operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const result = appendChangelog({
            parentType,
            parentId,
            taskId: params.taskId,
            summary: params.summary,
          });

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Append failed', result.code);
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const response = createSuccessResponse('Changelog entry created', { entry: result.data });
          return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
        }

        // ===== SEARCH OPERATION =====
        if (operation === 'search') {
          const result = searchChangelog({
            parentType,
            parentId,
            limit: params.limit,
            offset: params.offset,
          });

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Search failed', result.code);
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const response = createSuccessResponse(
            `Found ${result.data.length} changelog entry(ies)`,
            {
              entries: result.data,
              count: result.data.length,
              limit: params.limit,
              offset: params.offset,
            }
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
        }

        const response = createErrorResponse('Invalid operation');
        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      } catch (error: any) {
        const response = createErrorResponse(error.message || 'Internal error');
        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      }
    }
  );
}
