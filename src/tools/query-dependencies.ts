import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema } from './registry';
import { queryOne, queryAll } from '../repos/base';

type EntityType = 'task' | 'feature';

interface EntityRow {
  id: string;
  blocked_by: string;
  related_to: string;
}

interface DependencyLink {
  type: 'BLOCKS' | 'RELATES_TO';
  fromId: string;
  toId: string;
  fromEntityType?: EntityType;
  toEntityType?: EntityType;
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveEntityType(id: string): EntityType | null {
  const task = queryOne<{ id: string }>('SELECT id FROM tasks WHERE id = ?', [id]);
  if (task) return 'task';
  const feature = queryOne<{ id: string }>('SELECT id FROM features WHERE id = ?', [id]);
  if (feature) return 'feature';
  return null;
}

function getRow(entityType: EntityType, id: string): EntityRow | null {
  const table = entityType === 'task' ? 'tasks' : 'features';
  return queryOne<EntityRow>(
    `SELECT id, blocked_by, related_to FROM ${table} WHERE id = ?`,
    [id]
  );
}

export function registerQueryDependenciesTool(server: McpServer): void {
  server.tool(
    'query_dependencies',
    'Query dependencies for an entity (task or feature). Returns BLOCKS and RELATES_TO links from v3 field storage.',
    {
      id: uuidSchema.describe('Entity ID'),
      containerType: z.enum(['task', 'feature']).describe('Entity type to query dependencies for'),
      direction: z
        .enum(['dependencies', 'dependents', 'both'])
        .optional()
        .default('both')
        .describe('Direction filter: dependencies, dependents, or both'),
    },
    async (params) => {
      try {
        const { id, containerType, direction = 'both' } = params;
        const row = getRow(containerType, id);
        if (!row) {
          const response = createErrorResponse(`${containerType} not found: ${id}`, 'NOT_FOUND');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const dependencies: DependencyLink[] = [];
        const dependents: DependencyLink[] = [];

        if (direction === 'dependencies' || direction === 'both') {
          const blockers = parseJsonArray(row.blocked_by);
          for (const blockerId of blockers) {
            if (blockerId === 'NO_OP') {
              dependencies.push({
                type: 'BLOCKS',
                fromId: 'NO_OP',
                toId: id,
              });
              continue;
            }

            dependencies.push({
              type: 'BLOCKS',
              fromId: blockerId,
              toId: id,
              fromEntityType: resolveEntityType(blockerId) ?? undefined,
              toEntityType: containerType,
            });
          }

          const relatedTo = parseJsonArray(row.related_to);
          for (const relatedId of relatedTo) {
            dependencies.push({
              type: 'RELATES_TO',
              fromId: id,
              toId: relatedId,
              fromEntityType: containerType,
              toEntityType: resolveEntityType(relatedId) ?? undefined,
            });
          }
        }

        if (direction === 'dependents' || direction === 'both') {
          for (const table of ['tasks', 'features'] as const) {
            const entityType: EntityType = table === 'tasks' ? 'task' : 'feature';
            const rows = queryAll<EntityRow>(
              `SELECT id, blocked_by, related_to FROM ${table}
               WHERE EXISTS (SELECT 1 FROM json_each(blocked_by) WHERE value = ?)
                  OR EXISTS (SELECT 1 FROM json_each(related_to) WHERE value = ?)`,
              [id, id]
            );

            for (const candidate of rows) {
              if (candidate.id === id) continue;

              const blockers = parseJsonArray(candidate.blocked_by);
              if (blockers.includes(id)) {
                dependents.push({
                  type: 'BLOCKS',
                  fromId: id,
                  toId: candidate.id,
                  fromEntityType: containerType,
                  toEntityType: entityType,
                });
              }

              const relatedTo = parseJsonArray(candidate.related_to);
              if (relatedTo.includes(id)) {
                dependents.push({
                  type: 'RELATES_TO',
                  fromId: candidate.id,
                  toId: id,
                  fromEntityType: entityType,
                  toEntityType: containerType,
                });
              }
            }
          }
        }

        const response = createSuccessResponse('Dependencies retrieved', {
          id,
          containerType,
          direction,
          dependencies: direction === 'dependents' ? [] : dependencies,
          dependents: direction === 'dependencies' ? [] : dependents,
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
