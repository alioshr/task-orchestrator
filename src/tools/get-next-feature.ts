import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, optionalUuidSchema } from './registry';
import { queryOne } from '../repos/base';

export function registerGetNextFeatureTool(server: McpServer): void {
  server.tool(
    'get_next_feature',
    'Get the next recommended feature to work on. Prioritizes ACTIVE features (continuation work) over NEW features (new work). Only returns unblocked features. Ordered by priority (HIGH > MEDIUM > LOW), then oldest created_at.',
    {
      projectId: optionalUuidSchema.describe('Filter by project ID'),
      priority: z.string().optional().describe('Filter by priority (HIGH, MEDIUM, LOW)'),
    },
    async (params: any) => {
      try {
        const conditions: string[] = ["status IN ('ACTIVE', 'NEW')", "blocked_by = '[]'"];
        const values: any[] = [];

        if (params.projectId) {
          conditions.push('project_id = ?');
          values.push(params.projectId);
        }
        if (params.priority) {
          conditions.push('priority = ?');
          values.push(params.priority.toUpperCase());
        }

        const sql = `SELECT * FROM features
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE status WHEN 'ACTIVE' THEN 1 WHEN 'NEW' THEN 2 END ASC,
            CASE priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END ASC,
            created_at ASC
          LIMIT 1`;

        const row = queryOne<any>(sql, values);

        if (!row) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(createSuccessResponse('No available features found matching the criteria', null), null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createSuccessResponse('Next feature retrieved successfully', row), null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createErrorResponse('Failed to get next feature', error.message), null, 2),
          }],
        };
      }
    }
  );
}
