import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, optionalUuidSchema, uuidSchema } from './registry';
import { queryOne, execute, now } from '../repos/base';
import { isTerminal } from '../config';
import { transaction } from '../db/client';
import { DependencyType } from '../domain/types';

type EntityType = 'task' | 'feature';

interface EntityRow {
  id: string;
  status: string;
  blocked_by: string;
  blocked_reason: string | null;
  related_to: string;
}

interface ResolvedEntity {
  type: EntityType;
  row: EntityRow;
}

interface ManageDependencyErrorResult {
  error: string;
  code: string;
}

interface ManageDependencySuccessResult {
  success: true;
  data: Record<string, unknown>;
}

type ManageDependencyResult = ManageDependencyErrorResult | ManageDependencySuccessResult;

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getTable(type: EntityType): string {
  return type === 'task' ? 'tasks' : 'features';
}

function resolveEntity(id: string): ResolvedEntity | null {
  const task = queryOne<EntityRow>(
    'SELECT id, status, blocked_by, blocked_reason, related_to FROM tasks WHERE id = ?',
    [id]
  );
  if (task) return { type: 'task', row: task };

  const feature = queryOne<EntityRow>(
    'SELECT id, status, blocked_by, blocked_reason, related_to FROM features WHERE id = ?',
    [id]
  );
  if (feature) return { type: 'feature', row: feature };

  return null;
}

function setBlockedBy(type: EntityType, id: string, blockedBy: string[]): void {
  execute(
    `UPDATE ${getTable(type)} SET blocked_by = ?, version = version + 1, modified_at = ? WHERE id = ?`,
    [JSON.stringify(blockedBy), now(), id]
  );
}

function setRelatedTo(type: EntityType, id: string, relatedTo: string[]): void {
  execute(
    `UPDATE ${getTable(type)} SET related_to = ?, version = version + 1, modified_at = ? WHERE id = ?`,
    [JSON.stringify(relatedTo), now(), id]
  );
}

export function registerManageDependencyTool(server: McpServer): void {
  server.tool(
    'manage_dependency',
    'Manage dependencies between entities (create/delete). Supports BLOCKS and RELATES_TO. IS_BLOCKED_BY is removed in v3.',
    {
      operation: z.enum(['create', 'delete']),
      id: optionalUuidSchema.describe('Deprecated in v3: kept for backward compatibility but unused'),
      fromId: optionalUuidSchema.describe('Source entity ID (required for create/delete)'),
      toId: optionalUuidSchema.describe('Target entity ID (required for create/delete)'),
      containerType: z.enum(['task', 'feature']).optional().describe('Deprecated in v3: dependencies can be cross-entity'),
      type: z.enum(['BLOCKS', 'RELATES_TO']).optional().describe('Dependency type (required for create/delete)'),
    },
    async (params) => {
      try {
        const { operation } = params;
        const fromId = params.fromId;
        const toId = params.toId;
        const type = params.type as DependencyType | undefined;

        if (!fromId || !toId || !type) {
          const response = createErrorResponse(
            'fromId, toId, and type are required. In v3, delete by dependency ID is no longer supported.'
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        if (fromId === toId) {
          const response = createErrorResponse('Cannot create a dependency from an entity to itself');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const result: ManageDependencyResult = transaction(() => {
          const fromEntity = resolveEntity(fromId);
          if (!fromEntity) {
            return { error: `Entity not found: ${fromId}`, code: 'NOT_FOUND' as const };
          }

          const toEntity = resolveEntity(toId);
          if (!toEntity) {
            return { error: `Entity not found: ${toId}`, code: 'NOT_FOUND' as const };
          }

          if (type === 'BLOCKS') {
            if (isTerminal(fromEntity.type, fromEntity.row.status)) {
              return {
                error: `Cannot use blocker ${fromId}: entity is in terminal state ${fromEntity.row.status}`,
                code: 'VALIDATION_ERROR' as const,
              };
            }

            if (isTerminal(toEntity.type, toEntity.row.status)) {
              return {
                error: `Cannot block ${toId}: entity is in terminal state ${toEntity.row.status}`,
                code: 'VALIDATION_ERROR' as const,
              };
            }

            const current = parseJsonArray(toEntity.row.blocked_by);

            if (operation === 'create') {
              const next = current.includes(fromId) ? current : [...current, fromId];
              setBlockedBy(toEntity.type, toId, next);
              return {
                success: true as const,
                data: {
                  type,
                  operation,
                  fromId,
                  toId,
                  blockedBy: next,
                  targetType: toEntity.type,
                },
              };
            }

            const next = current.filter(v => v !== fromId);
            setBlockedBy(toEntity.type, toId, next);
            return {
              success: true as const,
              data: {
                type,
                operation,
                fromId,
                toId,
                blockedBy: next,
                targetType: toEntity.type,
              },
            };
          }

          // RELATES_TO: symmetric reference links.
          const fromRelated = parseJsonArray(fromEntity.row.related_to);
          const toRelated = parseJsonArray(toEntity.row.related_to);

          if (operation === 'create') {
            const nextFrom = fromRelated.includes(toId) ? fromRelated : [...fromRelated, toId];
            const nextTo = toRelated.includes(fromId) ? toRelated : [...toRelated, fromId];
            setRelatedTo(fromEntity.type, fromId, nextFrom);
            setRelatedTo(toEntity.type, toId, nextTo);
            return {
              success: true as const,
              data: {
                type,
                operation,
                fromId,
                toId,
                fromEntityType: fromEntity.type,
                toEntityType: toEntity.type,
              },
            };
          }

          const nextFrom = fromRelated.filter(v => v !== toId);
          const nextTo = toRelated.filter(v => v !== fromId);
          setRelatedTo(fromEntity.type, fromId, nextFrom);
          setRelatedTo(toEntity.type, toId, nextTo);
          return {
            success: true as const,
            data: {
              type,
              operation,
              fromId,
              toId,
              fromEntityType: fromEntity.type,
              toEntityType: toEntity.type,
            },
          };
        });

        if ('error' in result) {
          const response = createErrorResponse(result.error, result.code);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const response = createSuccessResponse('Dependency operation completed', result.data);
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
