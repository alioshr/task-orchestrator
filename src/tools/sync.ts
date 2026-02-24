import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, renameSync } from 'fs';
import { createSuccessResponse, createErrorResponse } from './registry';
import {
  getHomePath,
  getDbPath,
  getConfigPath,
  writeDefaultConfig,
  loadConfig,
  initConfig,
} from '../config';
import { db, closeDbConnection, reopenDbConnection, getActiveDbPath } from '../db/client';
import { runMigrations } from '../db/migrate';

function dbHasRecords(): boolean {
  try {
    const tables = ['projects', 'features', 'tasks'];
    for (const table of tables) {
      const row = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${table}`).get();
      if (row && row.count > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function registerSyncTool(server: McpServer): void {
  server.tool(
    'sync',
    'Sync the task orchestrator: creates config file and database if missing, applies pending migrations. If DB already has data, returns a warning unless override: true is passed (backs up existing DB and creates fresh one).',
    {
      override: z.boolean().optional().describe('Pass true to force re-initialization when data exists. Existing DB will be backed up.'),
    },
    async (params) => {
      try {
        const configPath = getConfigPath();
        const dbPath = getActiveDbPath() || getDbPath();
        const homePath = getHomePath();

        // Check if DB has existing records
        const hasData = dbHasRecords();

        if (hasData && !params.override) {
          const response = createErrorResponse(
            'Database already contains records. Call sync again with override: true to re-initialize. ' +
            'The existing database will be backed up. This operation is irreversible.',
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        if (hasData && params.override) {
          // Backup existing DB
          const d = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
          const backupName = `tasks.db.deprecated-${timestamp}.sqlite`;
          const backupPath = `${dbPath}.deprecated-${timestamp}.sqlite`;

          try {
            closeDbConnection();
            renameSync(dbPath, backupPath);
            // Also rename WAL and SHM files if they exist
            if (existsSync(`${dbPath}-wal`)) renameSync(`${dbPath}-wal`, `${backupPath}-wal`);
            if (existsSync(`${dbPath}-shm`)) renameSync(`${dbPath}-shm`, `${backupPath}-shm`);
          } catch (e: any) {
            // Attempt recovery so the current process remains usable.
            try {
              reopenDbConnection();
            } catch {
              // Ignore recovery errors; report original failure.
            }
            const response = createErrorResponse(`Failed to backup existing database: ${e.message}`);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          // Re-open at the original path and create a fresh database in-place.
          reopenDbConnection();
          runMigrations();

          const config = loadConfig(configPath);
          initConfig(config);

          const response = createSuccessResponse(
            `Existing database backed up to ${backupName}. Fresh database initialized at ${dbPath}.`,
            { backupPath, dbPath, homePath, configPath, pipelines: config.pipelines }
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        // Write config if it doesn't exist
        let configCreated = false;
        if (!existsSync(configPath)) {
          writeDefaultConfig(configPath);
          configCreated = true;
        }

        // Load and validate config
        const config = loadConfig(configPath);
        initConfig(config);

        // Run migrations (creates DB if needed)
        runMigrations();

        const message = configCreated
          ? 'Synced successfully. Config and database created. ' +
            'Optional pipeline states (TO_BE_TESTED, READY_TO_PROD) can be added to config before creating any data.'
          : 'Synced successfully. Config already existed, database ensured.';

        const response = createSuccessResponse(message, {
          homePath,
          configPath,
          dbPath,
          configCreated,
          pipelines: config.pipelines,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error: any) {
        const response = createErrorResponse(error.message);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      }
    }
  );
}
