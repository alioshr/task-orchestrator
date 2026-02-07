import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema } from './registry';
import { getDependencies } from '../repos/dependencies';
import { DependencyEntityType } from '../domain/types';

/**
 * Register the query_dependencies MCP tool.
 *
 * Queries dependencies for a task with optional direction filtering.
 *
 * @param server - The MCP server instance to register the tool with
 */
export function registerQueryDependenciesTool(server: McpServer): void {
  server.tool(
    'query_dependencies',
    'Query dependencies for an entity (task or feature)',
    {
      id: uuidSchema.describe('Entity ID (task or feature)'),
      containerType: z
        .enum(['task', 'feature'])
        .describe('Entity type to query dependencies for'),
      direction: z
        .enum(['dependencies', 'dependents', 'both'])
        .optional()
        .default('both')
        .describe('Direction filter: dependencies, dependents, or both'),
    },
    async (params) => {
      try {
        const result = getDependencies(params.id, params.direction, params.containerType as DependencyEntityType);

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
                createSuccessResponse('Dependencies retrieved', result.data),
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
