import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, optionalUuidSchema } from './registry';
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  enableTemplate,
  disableTemplate,
  addTemplateSection
} from '../repos/templates';

/**
 * Registers the `manage_template` MCP tool.
 *
 * Operations:
 * - create: Create a new template
 * - update: Update an existing template
 * - delete: Delete a template
 * - enable: Enable a template
 * - disable: Disable a template
 * - addSection: Add a section to a template
 */
export function registerManageTemplateTool(server: McpServer): void {
  server.tool(
    'manage_template',
    'Manage templates with operations: create, update, delete, enable, disable, or addSection',
    {
      operation: z.enum(['create', 'update', 'delete', 'enable', 'disable', 'addSection']),
      id: optionalUuidSchema,
      name: z.string().optional(),
      description: z.string().optional(),
      targetEntityType: z.string().optional(),
      isBuiltIn: z.boolean().optional(),
      isProtected: z.boolean().optional(),
      createdBy: z.string().optional(),
      tags: z.string().optional(),
      // Section-specific parameters (for addSection operation)
      title: z.string().optional(),
      usageDescription: z.string().optional(),
      contentSample: z.string().optional(),
      contentFormat: z.string().optional(),
      isRequired: z.boolean().optional(),
      ordinal: z.coerce.number().int().optional()
    },
    async (params: any) => {
      try {
        const operation = params.operation;

        // Validate ID for operations that require it
        const requiresId = ['update', 'delete', 'enable', 'disable', 'addSection'];
        if (requiresId.includes(operation) && !params.id) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse(`Template ID is required for ${operation} operation`),
                null,
                2
              )
            }]
          };
        }

        switch (operation) {
          case 'create': {
            // Validate required parameters for create
            if (!params.name || !params.description || !params.targetEntityType) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('name, description, and targetEntityType are required for create operation'),
                    null,
                    2
                  )
                }]
              };
            }

            const result = createTemplate({
              name: params.name,
              description: params.description,
              targetEntityType: params.targetEntityType,
              isBuiltIn: params.isBuiltIn,
              isProtected: params.isProtected,
              createdBy: params.createdBy,
              tags: params.tags
            });

            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error || 'Failed to create template'),
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
                  createSuccessResponse('Template created successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'update': {
            const updateParams: any = {};
            if (params.name !== undefined) updateParams.name = params.name;
            if (params.description !== undefined) updateParams.description = params.description;
            if (params.tags !== undefined) updateParams.tags = params.tags;

            const result = updateTemplate(params.id!, updateParams);

            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error || 'Failed to update template'),
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
                  createSuccessResponse('Template updated successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'delete': {
            const result = deleteTemplate(params.id!);

            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error || 'Failed to delete template'),
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
                  createSuccessResponse('Template deleted successfully', { deleted: true }),
                  null,
                  2
                )
              }]
            };
          }

          case 'enable': {
            const result = enableTemplate(params.id!);

            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error || 'Failed to enable template'),
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
                  createSuccessResponse('Template enabled successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'disable': {
            const result = disableTemplate(params.id!);

            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error || 'Failed to disable template'),
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
                  createSuccessResponse('Template disabled successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'addSection': {
            // Validate required parameters for addSection
            if (!params.title || !params.usageDescription || !params.contentSample) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('title, usageDescription, and contentSample are required for addSection operation'),
                    null,
                    2
                  )
                }]
              };
            }

            const result = addTemplateSection({
              templateId: params.id!,
              title: params.title,
              usageDescription: params.usageDescription,
              contentSample: params.contentSample,
              contentFormat: params.contentFormat,
              isRequired: params.isRequired,
              tags: params.tags,
              ordinal: params.ordinal
            });

            if (!result.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error || 'Failed to add template section'),
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
                  createSuccessResponse('Template section added successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          default:
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
