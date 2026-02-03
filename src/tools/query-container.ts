import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  searchProjects,
  getProjectOverview,
} from '../repos/projects';
import {
  createFeature,
  getFeature,
  updateFeature,
  deleteFeature,
  searchFeatures,
  getFeatureOverview,
} from '../repos/features';
import {
  createTask,
  getTask,
  updateTask,
  deleteTask,
  searchTasks,
  setTaskStatus,
} from '../repos/tasks';
import { getSections } from '../repos/sections';
import type { TaskCounts } from '../repos/base';

/**
 * Unified query_container tool - read operations for containers
 *
 * Operations:
 * - get: Retrieve a single container by ID
 * - search: Search containers with filters
 * - overview: Get global overview (all) or scoped overview (by ID + hierarchy)
 */
export function registerQueryContainerTool(server: McpServer): void {
  server.tool(
    'query_container',
    'Unified read operations for containers (project, feature, task). Supports get, search, and overview operations.',
    {
      operation: z.enum(['get', 'search', 'overview']),
      containerType: z.enum(['project', 'feature', 'task']),
      id: z.string().uuid().optional(),
      query: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      tags: z.string().optional(),
      projectId: z.string().uuid().optional(),
      featureId: z.string().uuid().optional(),
      limit: z.number().int().optional().default(20),
      offset: z.number().int().optional().default(0),
      includeSections: z.boolean().optional().default(false),
    },
    async (params) => {
      try {
        const { operation, containerType, id } = params;

        // ===== GET OPERATION =====
        if (operation === 'get') {
          if (!id) {
            const response = createErrorResponse('id is required for get operation');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          // Dispatch based on container type
          let result;
          if (containerType === 'project') {
            result = getProject(id);
          } else if (containerType === 'feature') {
            result = getFeature(id);
          } else {
            result = getTask(id);
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Failed to get container');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          let data: any = { [containerType]: result.data };

          // Include sections if requested
          if (params.includeSections) {
            const entityTypeMap = {
              project: 'PROJECT',
              feature: 'FEATURE',
              task: 'TASK',
            };
            const sectionsResult = getSections(id, entityTypeMap[containerType]);
            if (sectionsResult.success) {
              data.sections = sectionsResult.data;
            }
          }

          // Include task counts for features
          if (containerType === 'feature') {
            const overviewResult = getFeatureOverview(id);
            if (overviewResult.success) {
              data.taskCounts = overviewResult.data.taskCounts;
            }
          }

          // Include task counts for projects
          if (containerType === 'project') {
            const overviewResult = getProjectOverview(id);
            if (overviewResult.success) {
              data.taskCounts = overviewResult.data.taskCounts;
            }
          }

          const response = createSuccessResponse(`${containerType} retrieved successfully`, data);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        // ===== SEARCH OPERATION =====
        if (operation === 'search') {
          const searchParams = {
            query: params.query,
            status: params.status,
            priority: params.priority,
            tags: params.tags,
            projectId: params.projectId,
            featureId: params.featureId,
            limit: params.limit ?? 20,
            offset: params.offset ?? 0,
          };

          let result;
          if (containerType === 'project') {
            result = searchProjects(searchParams);
          } else if (containerType === 'feature') {
            result = searchFeatures(searchParams);
          } else {
            result = searchTasks(searchParams);
          }

          if (!result.success) {
            const response = createErrorResponse(result.error || 'Search failed');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          const response = createSuccessResponse(
            `Found ${result.data.length} ${containerType}(s)`,
            {
              items: result.data,
              count: result.data.length,
              limit: params.limit ?? 20,
              offset: params.offset ?? 0,
            }
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        // ===== OVERVIEW OPERATION =====
        if (operation === 'overview') {
          // Global overview - search all with filters
          if (!id) {
            const searchParams = {
              query: params.query,
              status: params.status,
              priority: params.priority,
              tags: params.tags,
              projectId: params.projectId,
              featureId: params.featureId,
              limit: params.limit ?? 20,
              offset: params.offset ?? 0,
            };

            let result;
            if (containerType === 'project') {
              result = searchProjects(searchParams);
            } else if (containerType === 'feature') {
              result = searchFeatures(searchParams);
            } else {
              result = searchTasks(searchParams);
            }

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Overview failed');
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
              };
            }

            const response = createSuccessResponse(
              `Global ${containerType} overview`,
              {
                items: result.data,
                count: result.data.length,
                limit: params.limit ?? 20,
                offset: params.offset ?? 0,
              }
            );
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          // Scoped overview - entity + hierarchy
          if (containerType === 'project') {
            const overviewResult = getProjectOverview(id);
            if (!overviewResult.success) {
              const response = createErrorResponse(
                'error' in overviewResult ? overviewResult.error : 'Failed to get project overview'
              );
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
              };
            }

            // Get features for this project
            const featuresResult = searchFeatures({ projectId: id, limit: 100 });
            const features = featuresResult.success ? featuresResult.data : [];

            const response = createSuccessResponse('Project overview retrieved', {
              project: overviewResult.data.project,
              taskCounts: overviewResult.data.taskCounts,
              features,
            });
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          if (containerType === 'feature') {
            const overviewResult = getFeatureOverview(id);
            if (!overviewResult.success) {
              const response = createErrorResponse(
                'error' in overviewResult ? overviewResult.error : 'Failed to get feature overview'
              );
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
              };
            }

            // Get tasks for this feature
            const tasksResult = searchTasks({ featureId: id, limit: 100 });
            const tasks = tasksResult.success ? tasksResult.data : [];

            const response = createSuccessResponse('Feature overview retrieved', {
              feature: overviewResult.data.feature,
              taskCounts: overviewResult.data.taskCounts,
              tasks,
            });
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          if (containerType === 'task') {
            const taskResult = getTask(id);
            if (!taskResult.success) {
              const response = createErrorResponse(
                'error' in taskResult ? taskResult.error : 'Failed to get task overview'
              );
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
              };
            }

            // For tasks, just return the task (dependencies could be added in future)
            const response = createSuccessResponse('Task overview retrieved', {
              task: taskResult.data,
            });
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }
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
