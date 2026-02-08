import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, optionalUuidSchema } from './registry';
import {
  createMolecule,
  updateMolecule,
  deleteMolecule,
} from '../repos/graph-molecules';
import {
  createAtom,
  updateAtom,
  deleteAtom,
} from '../repos/graph-atoms';

export function registerManageGraphTool(server: McpServer): void {
  server.tool(
    'manage_graph',
    'Write operations for the knowledge graph. Supports create, update, and delete for atoms and molecules. Uses optimistic locking (version required for update/delete).',
    {
      operation: z.enum(['create', 'update', 'delete']),
      entityType: z.enum(['atom', 'molecule']),
      id: optionalUuidSchema,
      projectId: optionalUuidSchema,
      name: z.string().optional(),
      paths: z.string().optional().describe('JSON array of glob patterns (for atoms)'),
      knowledge: z.string().optional(),
      knowledgeMode: z.enum(['overwrite', 'append']).optional().default('overwrite'),
      moleculeId: z.string()
        .optional()
        .transform(v => {
          if (v === undefined || v === null) return undefined;
          if (v === 'null' || v === '') return null;
          // Apply UUID normalization
          return v.replace(/-/g, '').toLowerCase();
        })
        .describe('Assign atom to molecule. Pass "null" to orphan.'),
      relatedAtoms: z.string().optional().describe('JSON array of { atomId, reason }'),
      relatedMolecules: z.string().optional().describe('JSON array of { moleculeId, reason }'),
      createdByTaskId: optionalUuidSchema,
      lastTaskId: optionalUuidSchema,
      version: z.coerce.number().int().optional(),
      cascade: z.boolean().optional().default(false),
    },
    async (params) => {
      try {
        const { operation, entityType } = params;

        // ===== CREATE OPERATION =====
        if (operation === 'create') {
          if (!params.projectId) {
            const response = createErrorResponse('projectId is required for create operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (!params.name) {
            const response = createErrorResponse('name is required for create operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (!params.createdByTaskId) {
            const response = createErrorResponse('createdByTaskId is required for create operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (entityType === 'molecule') {
            const result = createMolecule({
              projectId: params.projectId,
              name: params.name,
              knowledge: params.knowledge,
              relatedMolecules: params.relatedMolecules,
              createdByTaskId: params.createdByTaskId,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Create failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const response = createSuccessResponse('Molecule created successfully', { molecule: result.data });
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (entityType === 'atom') {
            if (!params.paths) {
              const response = createErrorResponse('paths is required for atom create operation');
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const result = createAtom({
              projectId: params.projectId,
              moleculeId: params.moleculeId,
              name: params.name,
              paths: params.paths,
              knowledge: params.knowledge,
              relatedAtoms: params.relatedAtoms,
              createdByTaskId: params.createdByTaskId,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Create failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const response = createSuccessResponse('Atom created successfully', { atom: result.data });
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
        }

        // ===== UPDATE OPERATION =====
        if (operation === 'update') {
          if (!params.id) {
            const response = createErrorResponse('id is required for update operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (params.version === undefined) {
            const response = createErrorResponse('version is required for update operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (entityType === 'molecule') {
            const result = updateMolecule(params.id, {
              name: params.name,
              knowledge: params.knowledge,
              knowledgeMode: params.knowledgeMode,
              relatedMolecules: params.relatedMolecules,
              lastTaskId: params.lastTaskId,
              version: params.version,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Update failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const response = createSuccessResponse('Molecule updated successfully', { molecule: result.data });
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (entityType === 'atom') {
            const result = updateAtom(params.id, {
              name: params.name,
              paths: params.paths,
              knowledge: params.knowledge,
              knowledgeMode: params.knowledgeMode,
              moleculeId: params.moleculeId,
              relatedAtoms: params.relatedAtoms,
              lastTaskId: params.lastTaskId,
              version: params.version,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Update failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const response = createSuccessResponse('Atom updated successfully', { atom: result.data });
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
        }

        // ===== DELETE OPERATION =====
        if (operation === 'delete') {
          if (!params.id) {
            const response = createErrorResponse('id is required for delete operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (params.version === undefined) {
            const response = createErrorResponse('version is required for delete operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (entityType === 'molecule') {
            const result = deleteMolecule(params.id, {
              version: params.version,
              cascade: params.cascade,
              lastTaskId: params.lastTaskId,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Delete failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const response = createSuccessResponse('Molecule deleted successfully', { deleted: true });
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (entityType === 'atom') {
            const result = deleteAtom(params.id, {
              version: params.version,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Delete failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const response = createSuccessResponse('Atom deleted successfully', { deleted: true });
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
        }

        const response = createErrorResponse('Invalid operation');
        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      } catch (error: any) {
        const response = createErrorResponse(error.message || 'Internal error');
        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      }
    }
  );
}
