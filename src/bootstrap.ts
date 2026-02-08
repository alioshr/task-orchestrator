import { existsSync } from 'fs';
import { runMigrations } from './db/migrate';
import { getConfigPath, getDbPath, writeDefaultConfig, initConfig } from './config';
import { runStartupChecks } from './config/startup-checks';

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
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    writeDefaultConfig(configPath);
  }

  runMigrations();
  initConfig();
  runStartupChecks();
}
