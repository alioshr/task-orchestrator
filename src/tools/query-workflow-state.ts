import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, dependencyContainerTypeSchema } from './registry';
import { getWorkflowState } from '../services/workflow';

export function registerQueryWorkflowStateTool(server: McpServer): void {
  server.tool(
    'query_workflow_state',
    'Query the full workflow state for a task or feature. Returns current status, next/previous states, terminal status, blocking info, pipeline position, and related entities.',
    {
      containerType: dependencyContainerTypeSchema.describe('Type of container (feature or task)'),
      id: uuidSchema.describe('ID of the container'),
    },
    async (params: any) => {
      try {
        const { containerType, id } = params;

        const stateResult = getWorkflowState(containerType, id);
        if (!stateResult.success) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createErrorResponse(stateResult.error, stateResult.code), null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              createSuccessResponse('Workflow state retrieved successfully', stateResult.data),
              null,
              2
            ),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createErrorResponse('Failed to query workflow state', error.message), null, 2),
          }],
        };
      }
    }
  );
}
