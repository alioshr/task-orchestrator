import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, dependencyContainerTypeSchema } from './registry';
import { queryOne, execute, now } from '../repos/base';
import { transaction } from '../db/client';

interface EntityRow {
  id: string;
  blocked_by: string;
  blocked_reason: string | null;
  version: number;
}

interface UnblockErrorResult {
  error: string;
  code: string;
}

interface UnblockSuccessResult {
  success: true;
  entity: any;
  removedBlockers: string[];
  remainingBlockers: string[];
  isFullyUnblocked: boolean;
}

type UnblockResult = UnblockSuccessResult | UnblockErrorResult;

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getTable(containerType: string): string {
  return containerType === 'task' ? 'tasks' : 'features';
}

function normalizeUnblockInput(blockedBy: unknown): string[] {
  if (blockedBy === 'NO_OP') {
    return ['NO_OP'];
  }

  if (Array.isArray(blockedBy)) {
    return blockedBy.map(item => {
      if (typeof item !== 'string') {
        throw new Error(`Invalid blockedBy item: expected string, got ${typeof item}`);
      }
      return item.replace(/-/g, '').toLowerCase();
    });
  }

  throw new Error('blockedBy must be an array of UUIDs or the string "NO_OP"');
}

export function registerUnblockTool(server: McpServer): void {
  server.tool(
    'unblock',
    'Remove specific blockers from a task or feature. Pass blockedBy as an array of UUIDs to remove, or "NO_OP" to remove the NO_OP blocker. Idempotent: succeeds even if blocker is already absent. Clears blockedReason when NO_OP is no longer present.',
    {
      containerType: dependencyContainerTypeSchema,
      id: uuidSchema,
      version: z.number().int().describe('Current version for optimistic locking'),
      blockedBy: z.union([
        z.array(z.string()),
        z.string().transform((s, ctx) => {
          if (s === 'NO_OP') return s;
          try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed) && parsed.every(i => typeof i === 'string')) return parsed;
          } catch {}
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected array of UUID strings or "NO_OP"' });
          return z.NEVER;
        }),
      ]).describe('Array of UUID strings to remove, or "NO_OP" to remove the NO_OP blocker'),
    },
    async (params) => {
      try {
        const { containerType, id, version, blockedBy } = params;
        const table = getTable(containerType);

        const toRemove = normalizeUnblockInput(blockedBy);

        const result: UnblockResult = transaction(() => {
          const entity = queryOne<EntityRow>(
            `SELECT id, blocked_by, blocked_reason, version FROM ${table} WHERE id = ?`,
            [id]
          );

          if (!entity) {
            return { error: `${containerType} not found: ${id}`, code: 'NOT_FOUND' };
          }

          if (entity.version !== version) {
            return { error: `Version conflict: expected ${version}, found ${entity.version}`, code: 'CONFLICT' };
          }

          const existingBlockers = parseJsonArray(entity.blocked_by);
          const remaining = existingBlockers.filter(b => !toRemove.includes(b));
          const removed = existingBlockers.filter(b => toRemove.includes(b));

          // Clear blocked_reason only when NO_OP is no longer present
          const clearReason = !remaining.includes('NO_OP');
          const newReason = clearReason ? null : entity.blocked_reason;

          const timestamp = now();

          execute(
            `UPDATE ${table} SET blocked_by = ?, blocked_reason = ?, version = version + 1, modified_at = ? WHERE id = ?`,
            [JSON.stringify(remaining), newReason, timestamp, id]
          );

          const updated = queryOne<any>(
            `SELECT * FROM ${table} WHERE id = ?`,
            [id]
          );

          return {
            success: true,
            entity: updated,
            removedBlockers: removed,
            remainingBlockers: remaining,
            isFullyUnblocked: remaining.length === 0,
          };
        });

        if ('error' in result) {
          const response = createErrorResponse(result.error, result.code);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const message = result.isFullyUnblocked
          ? `${containerType} fully unblocked. No remaining blockers.`
          : result.removedBlockers.length > 0
            ? `${containerType} partially unblocked: removed ${result.removedBlockers.length} blocker(s). ${result.remainingBlockers.length} remaining.`
            : `No matching blockers found to remove (idempotent success).`;

        const response = createSuccessResponse(message, {
          [params.containerType]: result.entity,
          removedBlockers: result.removedBlockers,
          remainingBlockers: result.remainingBlockers,
          isFullyUnblocked: result.isFullyUnblocked,
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
