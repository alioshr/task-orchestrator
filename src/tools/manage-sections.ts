import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import {
  addSection,
  updateSection,
  updateSectionText,
  deleteSection,
  reorderSections,
  bulkCreateSections,
  bulkDeleteSections
} from '../repos/sections';

/**
 * Register the manage_sections MCP tool
 *
 * Provides comprehensive section management with operations: add, update, updateText, delete, reorder, bulkCreate, bulkDelete.
 */
export function registerManageSectionsTool(server: McpServer): void {
  server.tool(
    'manage_sections',
    'Manage sections with operations: add (create new), update (modify fields), updateText (update content only), delete (remove), reorder (change ordinals), bulkCreate (create multiple), bulkDelete (remove multiple).',
    {
      operation: z.enum(['add', 'update', 'updateText', 'delete', 'reorder', 'bulkCreate', 'bulkDelete']).describe('The operation to perform'),
      entityType: z.enum(['PROJECT', 'FEATURE', 'TASK']).optional().describe('Required for: add, bulkCreate'),
      entityId: z.string().uuid().optional().describe('Required for: add, reorder, bulkCreate'),
      sectionId: z.string().uuid().optional().describe('Required for: update, updateText, delete'),
      title: z.string().optional().describe('Section title (for add/update)'),
      usageDescription: z.string().optional().describe('Description of how to use this section (for add/update)'),
      content: z.string().optional().describe('Section content (for add/update/updateText)'),
      contentFormat: z.enum(['PLAIN_TEXT', 'MARKDOWN', 'JSON', 'CODE']).optional().describe('Content format (for add/update)'),
      tags: z.string().optional().describe('Comma-separated tags (for add/update)'),
      ordinal: z.number().int().optional().describe('Display order (for add)'),
      version: z.number().int().optional().describe('Required for: update, updateText (for optimistic locking)'),
      orderedIds: z.string().optional().describe('Comma-separated section IDs in new order (for reorder)'),
      sections: z.string().optional().describe('JSON array of sections to create (for bulkCreate)'),
      sectionIds: z.string().optional().describe('Comma-separated section IDs to delete (for bulkDelete)')
    },
    async (params) => {
      try {
        switch (params.operation) {
          case 'add': {
            // Validate required parameters
            if (!params.entityType || !params.entityId || !params.title || !params.usageDescription || !params.content) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Missing required parameters for add: entityType, entityId, title, usageDescription, content'),
                    null,
                    2
                  )
                }]
              };
            }

            const result = addSection({
              entityType: params.entityType,
              entityId: params.entityId,
              title: params.title,
              usageDescription: params.usageDescription,
              content: params.content,
              contentFormat: params.contentFormat,
              ordinal: params.ordinal,
              tags: params.tags
            });

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
                  createSuccessResponse('Section added successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'update': {
            // Validate required parameters
            if (!params.sectionId || params.version === undefined) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Missing required parameters for update: sectionId, version'),
                    null,
                    2
                  )
                }]
              };
            }

            const result = updateSection(params.sectionId, {
              title: params.title,
              usageDescription: params.usageDescription,
              content: params.content,
              contentFormat: params.contentFormat,
              tags: params.tags,
              version: params.version
            });

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
                  createSuccessResponse('Section updated successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'updateText': {
            // Validate required parameters
            if (!params.sectionId || !params.content || params.version === undefined) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Missing required parameters for updateText: sectionId, content, version'),
                    null,
                    2
                  )
                }]
              };
            }

            const result = updateSectionText(params.sectionId, params.content, params.version);

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
                  createSuccessResponse('Section text updated successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'delete': {
            // Validate required parameters
            if (!params.sectionId) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Missing required parameter for delete: sectionId'),
                    null,
                    2
                  )
                }]
              };
            }

            const result = deleteSection(params.sectionId);

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
                  createSuccessResponse('Section deleted successfully', { deleted: result.data }),
                  null,
                  2
                )
              }]
            };
          }

          case 'reorder': {
            // Validate required parameters
            if (!params.entityId || !params.entityType || !params.orderedIds) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Missing required parameters for reorder: entityId, entityType, orderedIds'),
                    null,
                    2
                  )
                }]
              };
            }

            const orderedIds = params.orderedIds.split(',').map(id => id.trim());
            const result = reorderSections(params.entityId, params.entityType, orderedIds);

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
                  createSuccessResponse('Sections reordered successfully', { reordered: result.data }),
                  null,
                  2
                )
              }]
            };
          }

          case 'bulkCreate': {
            // Validate required parameters
            if (!params.sections) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Missing required parameter for bulkCreate: sections (JSON array string)'),
                    null,
                    2
                  )
                }]
              };
            }

            let sectionsArray;
            try {
              sectionsArray = JSON.parse(params.sections);
            } catch (error) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Invalid JSON format for sections parameter'),
                    null,
                    2
                  )
                }]
              };
            }

            const result = bulkCreateSections(sectionsArray);

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
                  createSuccessResponse('Sections bulk created successfully', result.data),
                  null,
                  2
                )
              }]
            };
          }

          case 'bulkDelete': {
            // Validate required parameters
            if (!params.sectionIds) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('Missing required parameter for bulkDelete: sectionIds'),
                    null,
                    2
                  )
                }]
              };
            }

            const sectionIds = params.sectionIds.split(',').map(id => id.trim());
            const result = bulkDeleteSections(sectionIds);

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
                  createSuccessResponse('Sections bulk deleted successfully', { deletedCount: result.data }),
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
                  createErrorResponse(`Invalid operation: ${params.operation}`),
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
              createErrorResponse(error.message || 'Failed to manage section'),
              null,
              2
            )
          }]
        };
      }
    }
  );
}
