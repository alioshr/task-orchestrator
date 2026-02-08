import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, optionalUuidSchema } from './registry';
import { queryAll } from '../repos/base';

export function registerGetBlockedTasksTool(server: McpServer): void {
  server.tool(
    'get_blocked_tasks',
    'Get all blocked tasks. Returns tasks that have a non-empty blocked_by field. Results are sorted by priority (descending) then creation time (ascending).',
    {
      projectId: optionalUuidSchema.describe('Filter by project ID'),
      featureId: optionalUuidSchema.describe('Filter by feature ID'),
    },
    async (params: any) => {
      try {
        const conditions: string[] = ["blocked_by != '[]'"];
        const values: any[] = [];

        if (params.projectId) {
          conditions.push('project_id = ?');
          values.push(params.projectId);
        }
        if (params.featureId) {
          conditions.push('feature_id = ?');
          values.push(params.featureId);
        }

        const sql = `SELECT * FROM tasks
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END ASC,
            created_at ASC`;

        const rows = queryAll<any>(sql, values);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createSuccessResponse(`Found ${rows.length} blocked task(s)`, rows), null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createErrorResponse('Failed to get blocked tasks', error.message), null, 2),
          }],
        };
      }
    }
  );
}
