import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema } from './registry';
import { applyTemplate } from '../repos/templates';

/**
 * Registers the `apply_template` MCP tool.
 *
 * Applies a template to an entity (PROJECT, FEATURE, or TASK),
 * creating sections from the template's section definitions.
 */
export function registerApplyTemplateTool(server: McpServer): void {
  server.tool(
    'apply_template',
    'Apply a template to an entity (PROJECT, FEATURE, or TASK), creating sections from the template',
    {
      templateId: uuidSchema,
      entityType: z.enum(['PROJECT', 'FEATURE', 'TASK']),
      entityId: uuidSchema
    },
    async (params: any) => {
      try {
        // Validate required parameters
        if (!params.templateId) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse('Template ID is required'),
                null,
                2
              )
            }]
          };
        }

        if (!params.entityType) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse('Entity type is required'),
                null,
                2
              )
            }]
          };
        }

        if (!params.entityId) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse('Entity ID is required'),
                null,
                2
              )
            }]
          };
        }

        // Validate entity type
        const validEntityTypes = ['PROJECT', 'FEATURE', 'TASK'];
        if (!validEntityTypes.includes(params.entityType)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse(
                  `Invalid entity type. Must be one of: ${validEntityTypes.join(', ')}`
                ),
                null,
                2
              )
            }]
          };
        }

        const result = applyTemplate(
          params.templateId,
          params.entityType,
          params.entityId
        );

        if (!result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse(result.error || 'Failed to apply template'),
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
                `Template applied successfully. Created ${result.data.length} section(s)`,
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
