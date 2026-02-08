import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, dependencyContainerTypeSchema } from './registry';
import { getPrevState, isTerminal, getPipelinePosition } from '../config';
import { queryOne, execute, now } from '../repos/base';
import { transaction } from '../db/client';

interface EntityRow {
  id: string;
  status: string;
  version: number;
}

interface RevertErrorResult {
  error: string;
  code: string;
}

interface RevertSuccessResult {
  success: true;
  entity: any;
  oldStatus: string;
  newStatus: string;
  pipelinePosition: string | null;
}

type RevertResult = RevertSuccessResult | RevertErrorResult;

function getTable(containerType: string): string {
  return containerType === 'task' ? 'tasks' : 'features';
}

export function registerRevertTool(server: McpServer): void {
  server.tool(
    'revert',
    'Revert a task or feature one step backward in its pipeline. Refuses from terminal states (CLOSED, WILL_NOT_IMPLEMENT) and from the first pipeline state.',
    {
      containerType: dependencyContainerTypeSchema,
      id: uuidSchema,
      version: z.number().int().describe('Current version for optimistic locking'),
    },
    async (params) => {
      try {
        const { containerType, id, version } = params;
        const table = getTable(containerType);

        const result: RevertResult = transaction(() => {
          const entity = queryOne<EntityRow>(
            `SELECT id, status, version FROM ${table} WHERE id = ?`,
            [id]
          );

          if (!entity) {
            return { error: `${containerType} not found: ${id}`, code: 'NOT_FOUND' };
          }

          if (entity.version !== version) {
            return { error: `Version conflict: expected ${version}, found ${entity.version}`, code: 'CONFLICT' };
          }

          if (isTerminal(containerType, entity.status)) {
            return { error: `Cannot revert: ${containerType} is in terminal state ${entity.status}. No transitions allowed from terminal states.`, code: 'INVALID_OPERATION' };
          }

          const prevState = getPrevState(containerType, entity.status);
          if (!prevState) {
            return { error: `Cannot revert: ${containerType} is already at the first pipeline state (${entity.status}).`, code: 'INVALID_OPERATION' };
          }

          const oldStatus = entity.status;
          const timestamp = now();

          execute(
            `UPDATE ${table} SET status = ?, version = version + 1, modified_at = ? WHERE id = ?`,
            [prevState, timestamp, id]
          );

          const updated = queryOne<any>(
            `SELECT * FROM ${table} WHERE id = ?`,
            [id]
          );

          return {
            success: true,
            entity: updated,
            oldStatus,
            newStatus: prevState,
            pipelinePosition: getPipelinePosition(containerType, prevState),
          };
        });

        if ('error' in result) {
          const response = createErrorResponse(result.error, result.code);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const message = `${containerType} reverted: ${result.oldStatus} → ${result.newStatus} (position: ${result.pipelinePosition})`;
        const response = createSuccessResponse(message, {
          [params.containerType]: result.entity,
          transition: { from: result.oldStatus, to: result.newStatus },
          pipelinePosition: result.pipelinePosition,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error: any) {
        const response = createErrorResponse(error.message || 'Internal error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      }
    }
  );
}
