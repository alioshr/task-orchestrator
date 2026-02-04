import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, optionalUuidSchema } from './registry';
import { createDependency, deleteDependency } from '../repos/dependencies';
import { DependencyType } from '../domain/types';

/**
 * Register the manage_dependency MCP tool.
 *
 * Manages dependencies between tasks with create and delete operations.
 *
 * @param server - The MCP server instance to register the tool with
 */
export function registerManageDependencyTool(server: McpServer): void {
  server.tool(
    'manage_dependency',
    'Manage dependencies between tasks (create, delete)',
    {
      operation: z
        .enum(['create', 'delete'])
        .describe('Operation to perform: create or delete'),
      id: optionalUuidSchema
        .describe('Dependency ID (required for delete operation)'),
      fromTaskId: optionalUuidSchema
        .describe('Source task ID (required for create operation)'),
      toTaskId: optionalUuidSchema
        .describe('Target task ID (required for create operation)'),
      type: z
        .enum(['BLOCKS', 'IS_BLOCKED_BY', 'RELATES_TO'])
        .optional()
        .describe('Dependency type (required for create operation)'),
    },
    async (params) => {
      try {
        const { operation } = params;

        // Handle create operation
        if (operation === 'create') {
          const { fromTaskId, toTaskId, type } = params;

          // Validate required parameters for create
          if (!fromTaskId) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('fromTaskId is required for create operation'),
                    null,
                    2
                  ),
                },
              ],
            };
          }

          if (!toTaskId) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('toTaskId is required for create operation'),
                    null,
                    2
                  ),
                },
              ],
            };
          }

          if (!type) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('type is required for create operation'),
                    null,
                    2
                  ),
                },
              ],
            };
          }

          const result = createDependency({
            fromTaskId,
            toTaskId,
            type: type as DependencyType,
          });

          if (result.success === false) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error, result.code),
                    null,
                    2
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  createSuccessResponse('Dependency created', result.data),
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Handle delete operation
        if (operation === 'delete') {
          const { id } = params;

          // Validate required parameters for delete
          if (!id) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse('id is required for delete operation'),
                    null,
                    2
                  ),
                },
              ],
            };
          }

          const result = deleteDependency(id);

          if (result.success === false) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    createErrorResponse(result.error, result.code),
                    null,
                    2
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  createSuccessResponse('Dependency deleted', { deleted: true }),
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Invalid operation (should never happen due to enum validation)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse(`Invalid operation: ${operation}`),
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(createErrorResponse(error.message), null, 2),
            },
          ],
        };
      }
    }
  );
}
