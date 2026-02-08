import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, optionalUuidSchema } from './registry';
import {
  createProject,
  updateProject,
  deleteProject,
} from '../repos/projects';
import {
  createFeature,
  updateFeature,
  deleteFeature,
} from '../repos/features';
import {
  createTask,
  updateTask,
  deleteTask,
} from '../repos/tasks';
import { Priority } from '../domain/types';

export function registerManageContainerTool(server: McpServer): void {
  server.tool(
    'manage_container',
    'Unified write operations for containers (project, feature, task). Supports create, update, and delete operations. Status changes are NOT allowed through update — use advance, revert, or terminate tools instead.',
    {
      operation: z.enum(['create', 'update', 'delete']),
      containerType: z.enum(['project', 'feature', 'task']),
      id: optionalUuidSchema,
      name: z.string().optional().describe('Display name for project and feature containers. Not used for tasks — use \'title\' instead.'),
      title: z.string().optional().describe('Display title for task containers. Not used for projects/features — use \'name\' instead.'),
      summary: z.string().optional(),
      description: z.string().optional(),
      priority: z.string().optional(),
      projectId: optionalUuidSchema,
      featureId: optionalUuidSchema,
      complexity: z.coerce.number().int().optional(),
      tags: z.string().optional(),
      relatedTo: z.string().optional().describe('Comma-separated list of related entity UUIDs (for update operation on features/tasks)'),
      version: z.coerce.number().int().optional(),
      cascade: z.boolean().optional().describe('For delete operation: if true, deletes all child entities recursively.'),
    },
    async (params) => {
      try {
        const { operation, containerType, id } = params;

        // ===== CREATE OPERATION =====
        if (operation === 'create') {
          const nameOrTitle = containerType === 'task' ? params.title : params.name;

          if (!nameOrTitle) {
            const fieldName = containerType === 'task' ? 'title' : 'name';
            const response = createErrorResponse(`${fieldName} is required for create operation`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (!params.summary) {
            const response = createErrorResponse('summary is required for create operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const tags = params.tags ? params.tags.split(',').map((t: string) => t.trim()) : undefined;

          let result;
          if (containerType === 'project') {
            result = createProject({
              name: nameOrTitle,
              summary: params.summary,
              description: params.description,
              tags,
            });
          } else if (containerType === 'feature') {
            if (!params.priority) {
              const response = createErrorResponse('priority is required for creating a feature');
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }
            result = createFeature({
              projectId: params.projectId,
              name: nameOrTitle,
              summary: params.summary,
              description: params.description,
              priority: params.priority as Priority,
              tags,
            });
          } else {
            if (!params.priority) {
              const response = createErrorResponse('priority is required for creating a task');
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }
            if (params.complexity === undefined) {
              const response = createErrorResponse('complexity is required for creating a task');
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }
            result = createTask({
              projectId: params.projectId,
              featureId: params.featureId,
              title: nameOrTitle,
              summary: params.summary,
              description: params.description,
              priority: params.priority as Priority,
              complexity: params.complexity,
              tags,
            });
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to create container');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const response = createSuccessResponse(`${containerType} created successfully`, { [containerType]: result.data });
          return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
        }

        // ===== UPDATE OPERATION =====
        if (operation === 'update') {
          if (!id) {
            const response = createErrorResponse('id is required for update operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (params.version === undefined) {
            const response = createErrorResponse('version is required for update operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const rawParams = params as Record<string, unknown>;
          if (rawParams.status !== undefined) {
            const response = createErrorResponse(
              'status cannot be updated via manage_container. Use advance, revert, or terminate tools.'
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const tags = params.tags ? params.tags.split(',').map((t: string) => t.trim()) : undefined;

          // Parse relatedTo if provided
          const relatedTo = params.relatedTo
            ? params.relatedTo.split(',').map((s: string) => s.trim().replace(/-/g, '').toLowerCase())
            : undefined;

          let result;
          if (containerType === 'project') {
            result = updateProject(id, {
              name: params.name,
              summary: params.summary,
              description: params.description,
              tags,
              version: params.version,
            });
          } else if (containerType === 'feature') {
            result = updateFeature(id, {
              name: params.name,
              summary: params.summary,
              description: params.description,
              priority: params.priority as Priority | undefined,
              projectId: params.projectId,
              tags,
              relatedTo,
              version: params.version,
            });
          } else {
            result = updateTask(id, {
              title: params.title,
              summary: params.summary,
              description: params.description,
              priority: params.priority as Priority | undefined,
              complexity: params.complexity,
              projectId: params.projectId,
              featureId: params.featureId,
              tags,
              relatedTo,
              version: params.version,
            });
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to update container');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const response = createSuccessResponse(`${containerType} updated successfully`, { [containerType]: result.data });
          return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
        }

        // ===== DELETE OPERATION =====
        if (operation === 'delete') {
          if (!id) {
            const response = createErrorResponse('id is required for delete operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const cascadeOption = params.cascade ? { cascade: true } : undefined;

          let result;
          if (containerType === 'project') {
            result = deleteProject(id, cascadeOption);
          } else if (containerType === 'feature') {
            result = deleteFeature(id, cascadeOption);
          } else {
            result = deleteTask(id);
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to delete container');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const response = createSuccessResponse(`${containerType} deleted successfully`, { deleted: true });
          return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
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
