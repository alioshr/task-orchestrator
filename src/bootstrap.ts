import { existsSync } from 'fs';
import { runMigrations } from './db/migrate';
import { getHomePath, getConfigPath, getDbPath, writeDefaultConfig, initConfig } from './config';
import { runStartupChecks } from './config/startup-checks';

function logBootstrapPaths(homePath: string, dbPath: string, configPath: string): void {
  if (process.env.TASK_ORCHESTRATOR_DEBUG_PATHS !== '1') {
    return;
  }

  console.error('[task-orchestrator] Storage paths:');
  console.error(`  home: ${homePath}`);
  console.error(`  db: ${dbPath}`);
  console.error(`  config: ${configPath}`);
}

/**
 * Safe bootstrap for library consumers.
 *
 * - Ensures config.yaml exists (creates default on first run).
 * - Always runs migrations (idempotent — skips already-applied ones).
 * - Loads config and checks for orphaned states.
 *
 * Set TASK_ORCHESTRATOR_HOME env before calling to control the storage directory.
 * Defaults to ~/.task-orchestrator/
 */
export function bootstrap(): void {
  const homePath = getHomePath();
  const dbPath = getDbPath();
  const configPath = getConfigPath();
  logBootstrapPaths(homePath, dbPath, configPath);

  if (!existsSync(configPath)) {
    writeDefaultConfig(configPath);
  }

  runMigrations();
  initConfig();
  runStartupChecks();
}
