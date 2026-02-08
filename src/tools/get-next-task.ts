import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, optionalUuidSchema } from './registry';
import { queryOne } from '../repos/base';

export function registerGetNextTaskTool(server: McpServer): void {
  server.tool(
    'get_next_task',
    'Get the next recommended task to work on. Returns the highest priority NEW task that is not blocked. Ordered by priority (HIGH > MEDIUM > LOW), complexity (simpler first), then oldest created_at.',
    {
      projectId: optionalUuidSchema.describe('Filter by project ID'),
      featureId: optionalUuidSchema.describe('Filter by feature ID'),
      priority: z.string().optional().describe('Filter by priority (HIGH, MEDIUM, LOW)'),
    },
    async (params: any) => {
      try {
        const conditions: string[] = ["status = 'NEW'", "blocked_by = '[]'"];
        const values: any[] = [];

        if (params.projectId) {
          conditions.push('project_id = ?');
          values.push(params.projectId);
        }
        if (params.featureId) {
          conditions.push('feature_id = ?');
          values.push(params.featureId);
        }
        if (params.priority) {
          conditions.push('priority = ?');
          values.push(params.priority.toUpperCase());
        }

        const sql = `SELECT * FROM tasks
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END ASC,
            complexity ASC,
            created_at ASC
          LIMIT 1`;

        const row = queryOne<any>(sql, values);

        if (!row) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createSuccessResponse('No available tasks found matching the criteria', null), null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createSuccessResponse('Next task retrieved successfully', row), null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createErrorResponse('Failed to get next task', error.message), null, 2),
          }],
        };
      }
    }
  );
}
