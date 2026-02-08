import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, dependencyContainerTypeSchema } from './registry';
import { isTerminal } from '../config';
import { queryOne, execute, now } from '../repos/base';
import { transaction } from '../db/client';

interface EntityRow {
  id: string;
  status: string;
  blocked_by: string;
  blocked_reason: string | null;
  version: number;
}

interface BlockErrorResult {
  error: string;
  code: string;
}

interface BlockSuccessResult {
  success: true;
  entity: any;
  addedBlockers: string[];
  totalBlockers: string[];
}

type BlockResult = BlockSuccessResult | BlockErrorResult;

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

const DASHLESS_UUID_REGEX = /^[0-9a-f]{32}$/i;

function isValidDashlessUuid(s: string): boolean {
  return DASHLESS_UUID_REGEX.test(s);
}

/**
 * Validate and normalize blockedBy input.
 * Returns { blockers: string[], isNoOp: boolean } or throws.
 */
function validateBlockedByInput(
  blockedBy: unknown,
  blockedReason: string | undefined
): { blockers: string[]; isNoOp: boolean } {
  if (blockedBy === 'NO_OP') {
    if (!blockedReason?.trim()) {
      throw new Error('blockedReason is required when blockedBy is NO_OP');
    }
    return { blockers: ['NO_OP'], isNoOp: true };
  }

  if (Array.isArray(blockedBy)) {
    if (blockedBy.length === 0) {
      throw new Error('blockedBy array must not be empty. Use unblock to remove blockers.');
    }

    const normalized: string[] = [];
    for (const item of blockedBy) {
      if (typeof item !== 'string') {
        throw new Error(`Invalid blockedBy item: expected UUID string, got ${typeof item}`);
      }
      // Normalize: remove dashes, lowercase
      const clean = item.replace(/-/g, '').toLowerCase();
      if (!isValidDashlessUuid(clean)) {
        throw new Error(`Invalid UUID in blockedBy: ${item}`);
      }
      normalized.push(clean);
    }
    return { blockers: normalized, isNoOp: false };
  }

  throw new Error('blockedBy must be an array of UUIDs or the string "NO_OP"');
}

export function registerBlockTool(server: McpServer): void {
  server.tool(
    'block',
    'Block a task or feature. blockedBy accepts an array of UUID strings (existing task/feature IDs that are not terminal) or the string "NO_OP" (requires blockedReason). Idempotent: existing blockers are preserved, new ones merged.',
    {
      containerType: dependencyContainerTypeSchema,
      id: uuidSchema,
      version: z.coerce.number().int().describe('Current version for optimistic locking'),
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
      ]).describe('Array of UUID strings or "NO_OP"'),
      blockedReason: z.string().optional().describe('Required when blockedBy is NO_OP. Optional context for UUID blockers.'),
    },
    async (params) => {
      try {
        const { containerType, id, version, blockedBy, blockedReason } = params;
        const table = getTable(containerType);

        // Validate input shape
        const { blockers: newBlockers, isNoOp } = validateBlockedByInput(blockedBy, blockedReason);

        const result: BlockResult = transaction(() => {
          const entity = queryOne<EntityRow>(
            `SELECT id, status, blocked_by, blocked_reason, version FROM ${table} WHERE id = ?`,
            [id]
          );

          if (!entity) {
            return { error: `${containerType} not found: ${id}`, code: 'NOT_FOUND' };
          }

          if (entity.version !== version) {
            return { error: `Version conflict: expected ${version}, found ${entity.version}`, code: 'CONFLICT' };
          }

          if (isTerminal(containerType, entity.status)) {
            return { error: `Cannot block: ${containerType} is in terminal state ${entity.status}`, code: 'INVALID_OPERATION' };
          }

          // Validate UUID blockers exist and are not terminal
          if (!isNoOp) {
            for (const blockerId of newBlockers) {
              // Check in both tasks and features tables
              const taskRow = queryOne<{ id: string; status: string }>(
                'SELECT id, status FROM tasks WHERE id = ?',
                [blockerId]
              );
              const featureRow = queryOne<{ id: string; status: string }>(
                'SELECT id, status FROM features WHERE id = ?',
                [blockerId]
              );

              const blockerEntity = taskRow || featureRow;
              if (!blockerEntity) {
                return { error: `Blocker entity not found: ${blockerId}`, code: 'VALIDATION_ERROR' };
              }

              const blockerType = taskRow ? 'task' : 'feature';
              if (isTerminal(blockerType, blockerEntity.status)) {
                return { error: `Cannot use ${blockerId} as blocker: it is in terminal state ${blockerEntity.status}`, code: 'VALIDATION_ERROR' };
              }
            }
          }

          // Merge with existing blockers (idempotent)
          const existingBlockers = parseJsonArray(entity.blocked_by);
          const mergedSet = new Set([...existingBlockers, ...newBlockers]);
          const merged = Array.from(mergedSet);

          const timestamp = now();
          const newReason = blockedReason?.trim() || entity.blocked_reason;

          execute(
            `UPDATE ${table} SET blocked_by = ?, blocked_reason = ?, version = version + 1, modified_at = ? WHERE id = ?`,
            [JSON.stringify(merged), newReason, timestamp, id]
          );

          const updated = queryOne<any>(
            `SELECT * FROM ${table} WHERE id = ?`,
            [id]
          );

          return {
            success: true,
            entity: updated,
            addedBlockers: newBlockers.filter(b => !existingBlockers.includes(b)),
            totalBlockers: merged,
          };
        });

        if ('error' in result) {
          const response = createErrorResponse(result.error, result.code);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const addedCount = result.addedBlockers.length;
        const message = addedCount > 0
          ? `${containerType} blocked: added ${addedCount} blocker(s). Total blockers: ${result.totalBlockers.length}.`
          : `${containerType} already blocked by all specified entities (no changes).`;

        const response = createSuccessResponse(message, {
          [params.containerType]: result.entity,
          addedBlockers: result.addedBlockers,
          totalBlockers: result.totalBlockers,
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
