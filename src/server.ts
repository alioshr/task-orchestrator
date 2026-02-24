#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { bootstrap } from './bootstrap';
import {
  clearRuntimeStatus,
  isPidAlive,
  readRuntimeStatus,
  writeRuntimeStatus,
} from './runtime-status';
import { resolveOrchestratorHomePath } from './storage-paths';
import {
  registerQueryContainerTool,
  registerManageContainerTool,
  registerQuerySectionsTool,
  registerManageSectionsTool,
  registerQueryTemplatesTool,
  registerManageTemplateTool,
  registerApplyTemplateTool,
  registerListTagsTool,
  registerGetTagUsageTool,
  registerRenameTagTool,
  registerGetNextTaskTool,
  registerGetBlockedTasksTool,
  registerGetNextFeatureTool,
  registerGetBlockedFeaturesTool,
  registerQueryWorkflowStateTool,
  registerQueryDependenciesTool,
  registerAdvanceTool,
  registerRevertTool,
  registerTerminateTool,
  registerBlockTool,
  registerUnblockTool,
  registerManageDependencyTool,
  registerSyncTool,
  registerQueryGraphTool,
  registerManageGraphTool,
  registerManageChangelogTool,
} from './tools';

bootstrap();

function registerAllTools(server: McpServer): void {
  // Container CRUD
  registerQueryContainerTool(server);
  registerManageContainerTool(server);

  // Sections
  registerQuerySectionsTool(server);
  registerManageSectionsTool(server);

  // Templates
  registerQueryTemplatesTool(server);
  registerManageTemplateTool(server);
  registerApplyTemplateTool(server);

  // Tags
  registerListTagsTool(server);
  registerGetTagUsageTool(server);
  registerRenameTagTool(server);

  // Workflow queries
  registerGetNextTaskTool(server);
  registerGetBlockedTasksTool(server);
  registerGetNextFeatureTool(server);
  registerGetBlockedFeaturesTool(server);
  registerQueryWorkflowStateTool(server);
  registerQueryDependenciesTool(server);

  // Pipeline tools (v3)
  registerAdvanceTool(server);
  registerRevertTool(server);
  registerTerminateTool(server);
  registerBlockTool(server);
  registerUnblockTool(server);
  registerManageDependencyTool(server);

  // Sync
  registerSyncTool(server);

  // Knowledge graph
  registerQueryGraphTool(server);
  registerManageGraphTool(server);
  registerManageChangelogTool(server);
}

// Create MCP server
const server = new McpServer({
  name: 'task-orchestrator',
  version: '3.0.0',
});

registerAllTools(server);

const SERVER_NAME = 'task-orchestrator';
const SERVER_VERSION = '3.0.0';

// Determine transport mode from CLI args or env
const useHttp = process.argv.includes('--http') || process.env.TRANSPORT === 'http';

if (useHttp) {
  const host = process.env.HOST || '127.0.0.1';
  const port = parseInt(process.env.PORT || '3100', 10);
  const homePath = resolveOrchestratorHomePath();
  const mcpUrl = `http://${host}:${port}/mcp`;
  const statusUrl = `http://${host}:${port}/status`;

  const publishRuntimeStatus = () =>
    writeRuntimeStatus({
      transport: 'http',
      mcpUrl,
      statusUrl,
      host,
      port,
      pid: process.pid,
      version: SERVER_VERSION,
      homePath,
      updatedAt: new Date().toISOString(),
    });

  const clearOwnedRuntimeStatus = () => {
    const runtimeStatus = readRuntimeStatus();
    if (runtimeStatus?.pid === process.pid) {
      clearRuntimeStatus();
    }
  };

  publishRuntimeStatus();
  process.on('exit', clearOwnedRuntimeStatus);
  process.on('SIGINT', () => {
    clearOwnedRuntimeStatus();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    clearOwnedRuntimeStatus();
    process.exit(0);
  });

  // Map of session ID -> transport for stateful sessions
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  const httpServer = Bun.serve({
    port,
    hostname: host,
    fetch: async (req: Request) => {
      const url = new URL(req.url);

      if (url.pathname === '/status') {
        const runtimeStatus = readRuntimeStatus();
        const isRunning = runtimeStatus ? isPidAlive(runtimeStatus.pid) : false;

        return new Response(
          JSON.stringify(
            {
              success: true,
              data: {
                running: isRunning,
                status: runtimeStatus,
              },
            },
            null,
            2
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      }

      if (url.pathname !== '/mcp') {
        return new Response('Not Found', { status: 404 });
      }

      // Check for existing session
      const sessionId = req.headers.get('mcp-session-id');
      if (sessionId && sessions.has(sessionId)) {
        return sessions.get(sessionId)!.handleRequest(req);
      }

      // New session — create transport and connect a fresh server instance
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
      });

      const sessionServer = new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
      });

      registerAllTools(sessionServer);

      await sessionServer.connect(transport);
      return transport.handleRequest(req);
    },
  });
  void httpServer;

  console.error(`Task Orchestrator MCP listening on ${mcpUrl}`);
  console.error(`Task Orchestrator status available at ${statusUrl}`);
} else {
  // Default: stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
