import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { runMigrations } from './db/migrate';
import {
  registerQueryContainerTool,
  registerManageContainerTool,
  registerQuerySectionsTool,
  registerManageSectionsTool,
  registerQueryTemplatesTool,
  registerManageTemplateTool,
  registerApplyTemplateTool,
  registerQueryDependenciesTool,
  registerManageDependencyTool,
  registerListTagsTool,
  registerGetTagUsageTool,
  registerRenameTagTool,
  registerGetNextTaskTool,
  registerGetBlockedTasksTool,
  registerGetNextStatusTool,
  registerQueryWorkflowStateTool,
  registerSetupProjectTool,
} from './tools';

// Initialize database and run migrations
runMigrations();

// Create MCP server
const server = new McpServer({
  name: 'task-orchestrator',
  version: '2.0.0',
});

// Register all tools
registerQueryContainerTool(server);
registerManageContainerTool(server);
registerQuerySectionsTool(server);
registerManageSectionsTool(server);
registerQueryTemplatesTool(server);
registerManageTemplateTool(server);
registerApplyTemplateTool(server);
registerQueryDependenciesTool(server);
registerManageDependencyTool(server);
registerListTagsTool(server);
registerGetTagUsageTool(server);
registerRenameTagTool(server);
registerGetNextTaskTool(server);
registerGetBlockedTasksTool(server);
registerGetNextStatusTool(server);
registerQueryWorkflowStateTool(server);
registerSetupProjectTool(server);

// Determine transport mode from CLI args or env
const useHttp = process.argv.includes('--http') || process.env.TRANSPORT === 'http';

if (useHttp) {
  const port = parseInt(process.env.PORT || '3100', 10);

  // Map of session ID -> transport for stateful sessions
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  Bun.serve({
    port,
    fetch: async (req: Request) => {
      const url = new URL(req.url);

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
        name: 'task-orchestrator',
        version: '2.0.0',
      });

      registerQueryContainerTool(sessionServer);
      registerManageContainerTool(sessionServer);
      registerQuerySectionsTool(sessionServer);
      registerManageSectionsTool(sessionServer);
      registerQueryTemplatesTool(sessionServer);
      registerManageTemplateTool(sessionServer);
      registerApplyTemplateTool(sessionServer);
      registerQueryDependenciesTool(sessionServer);
      registerManageDependencyTool(sessionServer);
      registerListTagsTool(sessionServer);
      registerGetTagUsageTool(sessionServer);
      registerRenameTagTool(sessionServer);
      registerGetNextTaskTool(sessionServer);
      registerGetBlockedTasksTool(sessionServer);
      registerGetNextStatusTool(sessionServer);
      registerQueryWorkflowStateTool(sessionServer);
      registerSetupProjectTool(sessionServer);

      await sessionServer.connect(transport);
      return transport.handleRequest(req);
    },
  });

  console.error(`Task Orchestrator MCP listening on http://localhost:${port}/mcp`);
} else {
  // Default: stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
