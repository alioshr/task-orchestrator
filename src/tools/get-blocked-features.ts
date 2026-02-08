import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, optionalUuidSchema } from './registry';
import { queryAll } from '../repos/base';

export function registerGetBlockedFeaturesTool(server: McpServer): void {
  server.tool(
    'get_blocked_features',
    'Get all blocked features. Returns features that have a non-empty blocked_by field. Results are sorted by priority (descending) then creation time (ascending).',
    {
      projectId: optionalUuidSchema.describe('Filter by project ID'),
    },
    async (params: any) => {
      try {
        const conditions: string[] = ["blocked_by != '[]'"];
        const values: any[] = [];

        if (params.projectId) {
          conditions.push('project_id = ?');
          values.push(params.projectId);
        }

        const sql = `SELECT * FROM features
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END ASC,
            created_at ASC`;

        const rows = queryAll<any>(sql, values);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createSuccessResponse(`Found ${rows.length} blocked feature(s)`, rows), null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createErrorResponse('Failed to get blocked features', error.message), null, 2),
          }],
        };
      }
    }
  );
}
