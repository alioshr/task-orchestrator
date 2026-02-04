import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, optionalUuidSchema } from './registry';
import { getTemplate, listTemplates } from '../repos/templates';

/**
 * Registers the `query_templates` MCP tool.
 *
 * Operations:
 * - get: Retrieve a single template by ID
 * - list: List templates with optional filters
 */
export function registerQueryTemplatesTool(server: McpServer): void {
  server.tool(
    'query_templates',
    'Query templates with operations: get (retrieve single template) or list (retrieve multiple templates with filters)',
    {
      operation: z.enum(['get', 'list']),
      id: optionalUuidSchema,
      includeSections: z.boolean().optional().default(false),
      targetEntityType: z.string().optional(),
      isBuiltIn: z.boolean().optional(),
      isEnabled: z.boolean().optional(),
      tags: z.string().optional()
    },
    async (params: any) => {
      try {
        const operation = params.operation;

        if (operation === 'get') {
          // Validate required parameters for get
          if (!params.id) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(
                  createErrorResponse('Template ID is required for get operation'),
                  null,
                  2
                )
              }]
            };
          }

          const includeSections = params.includeSections ?? false;
          const result = getTemplate(params.id, includeSections);

          if (!result.success) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(
                  createErrorResponse(result.error || 'Failed to get template'),
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
                createSuccessResponse('Template retrieved successfully', result.data),
                null,
                2
              )
            }]
          };
        } else if (operation === 'list') {
          // Build filter parameters
          const filters = {
            targetEntityType: params.targetEntityType,
            isBuiltIn: params.isBuiltIn,
            isEnabled: params.isEnabled,
            tags: params.tags
          };

          const result = listTemplates(filters);

          if (!result.success) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(
                  createErrorResponse(result.error || 'Failed to list templates'),
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
                  `Found ${result.data.length} template(s)`,
                  result.data
                ),
                null,
                2
              )
            }]
          };
        } else {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse(`Invalid operation: ${operation}`),
                null,
                2
              )
            }]
          };
        }
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createErrorResponse(
                'Internal error',
                error.message || 'Unknown error occurred'
              ),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
