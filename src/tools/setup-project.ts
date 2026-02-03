import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './registry';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_CONFIG_YAML = `# Task Orchestrator Configuration
version: "2.0"

workflows:
  project:
    statuses:
      - PLANNING
      - IN_DEVELOPMENT
      - ON_HOLD
      - CANCELLED
      - COMPLETED
      - ARCHIVED
    transitions:
      PLANNING: [IN_DEVELOPMENT, ON_HOLD, CANCELLED]
      IN_DEVELOPMENT: [COMPLETED, ON_HOLD, CANCELLED]
      ON_HOLD: [PLANNING, IN_DEVELOPMENT, CANCELLED]
      COMPLETED: [ARCHIVED]
      CANCELLED: [PLANNING]
      ARCHIVED: []

  feature:
    statuses:
      - DRAFT
      - PLANNING
      - IN_DEVELOPMENT
      - TESTING
      - VALIDATING
      - PENDING_REVIEW
      - BLOCKED
      - ON_HOLD
      - DEPLOYED
      - COMPLETED
      - ARCHIVED
    transitions:
      DRAFT: [PLANNING]
      PLANNING: [IN_DEVELOPMENT, ON_HOLD]
      IN_DEVELOPMENT: [TESTING, BLOCKED, ON_HOLD]
      TESTING: [VALIDATING, IN_DEVELOPMENT]
      VALIDATING: [PENDING_REVIEW, IN_DEVELOPMENT]
      PENDING_REVIEW: [DEPLOYED, IN_DEVELOPMENT]
      BLOCKED: [IN_DEVELOPMENT, ON_HOLD]
      ON_HOLD: [PLANNING, IN_DEVELOPMENT]
      DEPLOYED: [COMPLETED]
      COMPLETED: [ARCHIVED]
      ARCHIVED: []

  task:
    statuses:
      - BACKLOG
      - PENDING
      - IN_PROGRESS
      - IN_REVIEW
      - CHANGES_REQUESTED
      - TESTING
      - READY_FOR_QA
      - INVESTIGATING
      - BLOCKED
      - ON_HOLD
      - DEPLOYED
      - COMPLETED
      - CANCELLED
      - DEFERRED
    transitions:
      BACKLOG: [PENDING]
      PENDING: [IN_PROGRESS, BLOCKED, ON_HOLD, CANCELLED, DEFERRED]
      IN_PROGRESS: [IN_REVIEW, TESTING, BLOCKED, ON_HOLD, COMPLETED]
      IN_REVIEW: [CHANGES_REQUESTED, COMPLETED]
      CHANGES_REQUESTED: [IN_PROGRESS]
      TESTING: [READY_FOR_QA, IN_PROGRESS]
      READY_FOR_QA: [INVESTIGATING, DEPLOYED, COMPLETED]
      INVESTIGATING: [IN_PROGRESS, BLOCKED]
      BLOCKED: [PENDING, IN_PROGRESS]
      ON_HOLD: [PENDING, IN_PROGRESS]
      DEPLOYED: [COMPLETED]
      COMPLETED: []
      CANCELLED: [BACKLOG, PENDING]
      DEFERRED: [BACKLOG, PENDING]
`;

/**
 * Sets up a project with Task Orchestrator configuration
 * Creates .taskorchestrator/config.yaml with default status workflows
 * Idempotent - skips if configuration already exists
 */
export function registerSetupProjectTool(server: McpServer): void {
  server.tool(
    'setup_project',
    'Set up Task Orchestrator configuration in a project. Creates .taskorchestrator/config.yaml with default workflow definitions for projects, features, and tasks. Idempotent - safely skips if already configured.',
    {
      projectPath: z
        .string()
        .optional()
        .describe('Project directory path. Defaults to current working directory.'),
    },
    async (params: any) => {
      try {
        // Determine project path
        const projectPath = params.projectPath || process.cwd();
        const configDir = join(projectPath, '.taskorchestrator');
        const configFilePath = join(configDir, 'config.yaml');

        // Check if config already exists
        if (existsSync(configFilePath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  createSuccessResponse(
                    'Project already configured',
                    {
                      path: configFilePath,
                      alreadyExists: true,
                      message: 'Configuration file already exists. No changes made.',
                    }
                  ),
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Create directory if it doesn't exist
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }

        // Write default configuration
        writeFileSync(configFilePath, DEFAULT_CONFIG_YAML, 'utf-8');

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                createSuccessResponse('Project configured successfully', {
                  path: configFilePath,
                  created: true,
                  message:
                    'Created .taskorchestrator/config.yaml with default workflow definitions.',
                  workflows: {
                    project: {
                      statuses: 6,
                      description: 'Project lifecycle management',
                    },
                    feature: {
                      statuses: 11,
                      description: 'Feature development workflow',
                    },
                    task: {
                      statuses: 14,
                      description: 'Task tracking workflow',
                    },
                  },
                }),
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                createErrorResponse(
                  `Failed to set up project: ${error.message}`,
                  error.stack
                ),
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
