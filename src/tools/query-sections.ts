import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema } from './registry';
import { getSections } from '../repos/sections';

/**
 * Register the query_sections MCP tool
 *
 * Retrieves sections for a given entity with optional filtering and content inclusion.
 */
export function registerQuerySectionsTool(server: McpServer): void {
  server.tool(
    'query_sections',
    'Retrieve sections for an entity (PROJECT, FEATURE, or TASK). Supports filtering by tags, section IDs, and optional content exclusion for token savings.',
    {
      entityType: z.enum(['PROJECT', 'FEATURE', 'TASK']).describe('The type of entity to query sections for'),
      entityId: uuidSchema.describe('The UUID of the entity'),
      includeContent: z.boolean().optional().default(true).describe('Set to false to exclude content field for token savings'),
      tags: z.string().optional().describe('Comma-separated list of tags to filter sections'),
      sectionIds: z.string().optional().describe('Comma-separated list of section IDs to filter')
    },
    async (params) => {
      try {
        // Parse sectionIds if provided
        const sectionIds = params.sectionIds
          ? params.sectionIds.split(',').map(id => id.trim())
          : undefined;

        // Call getSections with parsed parameters
        const result = getSections(params.entityId, params.entityType, {
          includeContent: params.includeContent,
          tags: params.tags,
          sectionIds
        });

        // Handle result
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
              createSuccessResponse('Sections retrieved successfully', result.data),
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
              createErrorResponse(error.message || 'Failed to query sections'),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
