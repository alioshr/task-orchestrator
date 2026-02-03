import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
