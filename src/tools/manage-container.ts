import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
} from '../repos/projects';
import {
  createFeature,
  getFeature,
  updateFeature,
  deleteFeature,
} from '../repos/features';
import {
  createTask,
  getTask,
  updateTask,
  deleteTask,
  setTaskStatus,
} from '../repos/tasks';
import { ProjectStatus, FeatureStatus, TaskStatus, Priority } from '../domain/types';

/**
 * Unified manage_container tool - write operations for containers
 *
 * Operations:
 * - create: Create a new container
 * - update: Update an existing container (requires version)
 * - delete: Delete a container
 * - setStatus: Update status only (requires version)
 */
export function registerManageContainerTool(server: McpServer): void {
  server.tool(
    'manage_container',
    'Unified write operations for containers (project, feature, task). Supports create, update, delete, and setStatus operations.',
    {
      operation: z.enum(['create', 'update', 'delete', 'setStatus']),
      containerType: z.enum(['project', 'feature', 'task']),
      id: z.string().uuid().optional(),
      name: z.string().optional(),
      title: z.string().optional(),
      summary: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      projectId: z.string().uuid().optional(),
      featureId: z.string().uuid().optional(),
      complexity: z.number().int().optional(),
      tags: z.string().optional(),
      version: z.number().int().optional(),
    },
    async (params) => {
      try {
        const { operation, containerType, id } = params;

        // ===== CREATE OPERATION =====
        if (operation === 'create') {
          // Projects and features use 'name', tasks use 'title'
          const nameOrTitle =
            containerType === 'task'
              ? params.title
              : params.name;

          if (!nameOrTitle) {
            const fieldName = containerType === 'task' ? 'title' : 'name';
            const response = createErrorResponse(`${fieldName} is required for create operation`);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          if (!params.summary) {
            const response = createErrorResponse('summary is required for create operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          // Parse tags if provided
          const tags = params.tags ? params.tags.split(',').map((t) => t.trim()) : undefined;

          let result;
          if (containerType === 'project') {
            result = createProject({
              name: nameOrTitle,
              summary: params.summary,
              description: params.description,
              status: params.status as ProjectStatus | undefined,
              tags,
            });
          } else if (containerType === 'feature') {
            if (!params.priority) {
              const response = createErrorResponse('priority is required for creating a feature');
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
              };
            }

            result = createFeature({
              projectId: params.projectId,
              name: nameOrTitle,
              summary: params.summary,
              description: params.description,
              status: params.status as FeatureStatus | undefined,
              priority: params.priority as Priority,
              tags,
            });
          } else {
            // task
            if (!params.priority) {
              const response = createErrorResponse('priority is required for creating a task');
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
              };
            }

            if (params.complexity === undefined) {
              const response = createErrorResponse('complexity is required for creating a task');
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
              };
            }

            result = createTask({
              projectId: params.projectId,
              featureId: params.featureId,
              title: nameOrTitle,
              summary: params.summary,
              description: params.description,
              status: params.status as TaskStatus | undefined,
              priority: params.priority as Priority,
              complexity: params.complexity,
              tags,
            });
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to create container');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          const response = createSuccessResponse(
            `${containerType} created successfully`,
            { [containerType]: result.data }
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        // ===== UPDATE OPERATION =====
        if (operation === 'update') {
          if (!id) {
            const response = createErrorResponse('id is required for update operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          if (params.version === undefined) {
            const response = createErrorResponse('version is required for update operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          // Parse tags if provided
          const tags = params.tags ? params.tags.split(',').map((t) => t.trim()) : undefined;

          let result;
          if (containerType === 'project') {
            result = updateProject(id, {
              name: params.name,
              summary: params.summary,
              description: params.description,
              status: params.status as ProjectStatus | undefined,
              tags,
              version: params.version,
            });
          } else if (containerType === 'feature') {
            result = updateFeature(id, {
              name: params.name,
              summary: params.summary,
              description: params.description,
              status: params.status as FeatureStatus | undefined,
              priority: params.priority as Priority | undefined,
              projectId: params.projectId,
              tags,
              version: params.version,
            });
          } else {
            // task
            result = updateTask(id, {
              title: params.title,
              summary: params.summary,
              description: params.description,
              status: params.status as TaskStatus | undefined,
              priority: params.priority as Priority | undefined,
              complexity: params.complexity,
              projectId: params.projectId,
              featureId: params.featureId,
              tags,
              version: params.version,
            });
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to update container');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          const response = createSuccessResponse(
            `${containerType} updated successfully`,
            { [containerType]: result.data }
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        // ===== DELETE OPERATION =====
        if (operation === 'delete') {
          if (!id) {
            const response = createErrorResponse('id is required for delete operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          let result;
          if (containerType === 'project') {
            result = deleteProject(id);
          } else if (containerType === 'feature') {
            result = deleteFeature(id);
          } else {
            result = deleteTask(id);
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to delete container');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          const response = createSuccessResponse(
            `${containerType} deleted successfully`,
            { deleted: true }
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        // ===== SET STATUS OPERATION =====
        if (operation === 'setStatus') {
          if (!id) {
            const response = createErrorResponse('id is required for setStatus operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          if (!params.status) {
            const response = createErrorResponse('status is required for setStatus operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          if (params.version === undefined) {
            const response = createErrorResponse('version is required for setStatus operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          let result;
          if (containerType === 'task') {
            // Tasks have a dedicated setTaskStatus function
            result = setTaskStatus(id, params.status as TaskStatus, params.version);
          } else {
            // For projects and features, use update with only status
            if (containerType === 'project') {
              result = updateProject(id, {
                status: params.status as ProjectStatus,
                version: params.version,
              });
            } else {
              result = updateFeature(id, {
                status: params.status as FeatureStatus,
                version: params.version,
              });
            }
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to set status');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          const response = createSuccessResponse(
            `${containerType} status updated successfully`,
            { [containerType]: result.data }
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        const response = createErrorResponse('Invalid operation');
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
